import { useState, useEffect, useRef, useCallback } from "react";
import BpmnModeler from "bpmn-js/lib/Modeler";
// @ts-ignore
import zeebeModdle from "zeebe-bpmn-moddle/resources/zeebe.json";
import { toast } from "sonner";

interface UseBpmnModelerOptions {
  entityId: string;
  entityType: "service" | "subprocess";
  onAutoSave?: () => void;
}

export function useBpmnModeler({ entityId, entityType, onAutoSave }: UseBpmnModelerOptions) {
  const [modeler, setModeler] = useState<BpmnModeler | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const changeListenersRef = useRef<Set<() => void>>(new Set());
  const suppressSaveRef = useRef(false);
  const tabIdRef = useRef(`tab_${Math.random().toString(36).substring(7)}`);

  const tableName = entityType === "service" ? "manual_services" : "subprocesses";

  // Initialize modeler once
  useEffect(() => {
    const container = document.createElement("div");
    container.style.display = "none";
    document.body.appendChild(container);
    containerRef.current = container;

    const mod = new BpmnModeler({
      container,
      moddleExtensions: { zeebe: zeebeModdle as any },
    });

    setModeler(mod);

    return () => {
      mod.destroy();
      document.body.removeChild(container);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Helper to clean HTML-wrapped XML
  const cleanXml = (xml: string): string => {
    // Check if XML is wrapped in HTML tags (corrupted data)
    if (xml.includes('<html>') || xml.includes('<body>')) {
      // Extract just the BPMN content
      const match = xml.match(/<bpmn:definitions[\s\S]*<\/bpmn:definitions>/);
      if (match) {
        return match[0];
      }
    }
    return xml;
  };

  // Detect corrupted XML (HTML-wrapped or lowercased BPMN tags/attrs)
  const isCorruptedXml = (xml: string): boolean => {
    // Direct HTML markers = definitely corrupted
    if (xml.includes('<html') || xml.includes('<body')) return true;

    // Detect lowercased BPMN tags/attributes in the ORIGINAL (case-sensitive) string.
    // Valid BPMN uses camelCase attributes like targetNamespace, exporterVersion, isExecutable, sourceRef, targetRef
    // and tag names like <bpmn:StartEvent>, <bpmndi:BPMNDiagram>, <dc:Bounds>.
    return (
      xml.includes('<bpmn:startevent') || // should be <bpmn:StartEvent>
      xml.includes('<bpmndi:bpmndiagram') || // should be <bpmndi:BPMNDiagram>
      xml.includes('<dc:bounds') || // should be <dc:Bounds>
      xml.includes('targetnamespace=') || // should be targetNamespace=
      xml.includes('exporterversion=') || // should be exporterVersion=
      xml.includes('isexecutable=') || // should be isExecutable=
      xml.includes('sourceref=') || // should be sourceRef=
      xml.includes('targetref=') // should be targetRef=
    );
  };

  // Load XML from database
  const loadXml = useCallback(
    async (xml: string) => {
      if (!modeler) return;
      try {
        suppressSaveRef.current = true;
        const cleanedXml = cleanXml(xml);
        await modeler.importXML(cleanedXml);
        suppressSaveRef.current = false;
        setError(null);
      } catch (err: any) {
        console.error("Error importing XML:", err);
        console.error("Error details:", err.message);
        console.error("Error warnings:", err.warnings);
        try {
          await modeler.createDiagram();
          suppressSaveRef.current = false;
          setError(null);
          toast.error(`Import failed: ${err.message || 'Unknown error'}. Created blank canvas.`);
        } catch (e2) {
          setError("Failed to load BPMN diagram");
          toast.error("Failed to load BPMN diagram");
        }
      }
    },
    [modeler]
  );

  // Save XML to string
  const saveXml = useCallback(async (): Promise<string | null> => {
    if (!modeler) return null;
    try {
      const { xml } = await modeler.saveXML({ format: true });
      if (!xml || !xml.includes("<bpmn:definitions")) {
        throw new Error("Invalid BPMN XML");
      }
      return xml;
    } catch (err) {
      console.error("Error saving XML:", err);
      toast.error("Failed to save BPMN");
      return null;
    }
  }, [modeler]);

  // Debounced save to Supabase
  const debouncedSave = useCallback(async () => {
    if (!modeler || suppressSaveRef.current) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const xml = await saveXml();
        if (!xml) return;

        const { supabase } = await import("@/integrations/supabase/client");
        const { error } = await supabase
          .from(tableName)
          .update({ edited_bpmn_xml: xml })
          .eq("id", entityId);

        if (error) throw error;

        // Broadcast to other tabs
        const bc = new BroadcastChannel("bpmn");
        bc.postMessage({ entityId, timestamp: Date.now(), tabId: tabIdRef.current });
        bc.close();

        onAutoSave?.();
      } catch (err) {
        console.error("Error saving to database:", err);
        toast.error("Failed to save changes");
      }
    }, 1200);
  }, [modeler, saveXml, tableName, entityId, onAutoSave]);

  // Subscribe to changes
  useEffect(() => {
    if (!modeler) return;

    const eventBus = modeler.get("eventBus") as any;
    
    const handleChange = () => {
      if (suppressSaveRef.current) return;
      debouncedSave();
      changeListenersRef.current.forEach((cb) => cb());
    };

    eventBus.on("commandStack.changed", handleChange);

    return () => {
      eventBus.off("commandStack.changed", handleChange);
    };
  }, [modeler, debouncedSave]);

  // Load initial XML
  useEffect(() => {
    if (!modeler) return;

    const loadInitial = async () => {
      setLoading(true);
      try {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data, error } = await supabase
          .from(tableName)
          .select("original_bpmn_xml, edited_bpmn_xml")
          .eq("id", entityId)
          .single();

        if (error) throw error;

        const edited = (data.edited_bpmn_xml as string | null) || null;
        const original = (data.original_bpmn_xml as string | null) || null;
        let xmlToLoad = edited || original || "";

        // If edited XML looks corrupted (HTML-wrapped or lowercased), fall back to original
        if (edited && isCorruptedXml(edited) && original) {
          xmlToLoad = original;
          try {
            const { supabase } = await import("@/integrations/supabase/client");
            await supabase
              .from(tableName)
              .update({ edited_bpmn_xml: null })
              .eq("id", entityId);
            toast.info("Recovered diagram from original version");
          } catch (e) {
            console.warn("Failed to clear corrupted edited_bpmn_xml:", e);
          }
        }

        if (!xmlToLoad) {
          // No BPMN present yet (e.g., generation still running). Initialize a blank diagram
          try {
            await modeler.createDiagram();
            const created = await saveXml();
            if (created) {
              const { supabase } = await import("@/integrations/supabase/client");
              await supabase
                .from(tableName)
                .update({ edited_bpmn_xml: created })
                .eq("id", entityId);
              await loadXml(created);
              toast.info("No BPMN found yet — initialized a blank diagram");
              return;
            }
          } catch (e) {
            console.error("Failed to initialize blank diagram:", e);
          }
          throw new Error("No BPMN diagram found");
        }

        await loadXml(xmlToLoad);
      } catch (err) {
        console.error("Error loading initial XML:", err);
        setError("Failed to load BPMN diagram");
        toast.error("Failed to load BPMN diagram");
      } finally {
        setLoading(false);
      }
    };

    loadInitial();
  }, [modeler, entityId, tableName, loadXml]);

  // Listen for changes from other tabs
  useEffect(() => {
    const bc = new BroadcastChannel("bpmn");
    
    bc.onmessage = async (event) => {
      if (event.data.entityId !== entityId) return;
      
      // Ignore messages from this tab
      if (event.data.tabId === tabIdRef.current) return;
      
      // Reload from database
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from(tableName)
        .select("edited_bpmn_xml, original_bpmn_xml")
        .eq("id", entityId)
        .single();

      if (data) {
        const xml = data.edited_bpmn_xml || data.original_bpmn_xml;
        if (xml) {
          await loadXml(xml);
          toast.info("Updated from another tab");
        }
      }
    };

    return () => bc.close();
  }, [entityId, tableName, loadXml]);

  // Subscribe to changes
  const onChange = useCallback((callback: () => void) => {
    changeListenersRef.current.add(callback);
    return () => {
      changeListenersRef.current.delete(callback);
    };
  }, []);

  // Undo
  const undo = useCallback(() => {
    if (!modeler) return;
    const commandStack = modeler.get("commandStack") as any;
    if (commandStack.canUndo()) {
      commandStack.undo();
      toast.success("Undone");
    } else {
      toast.info("Nothing to undo");
    }
  }, [modeler]);

  // Reset to original
  const reset = useCallback(async () => {
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      
      // Clear edited version
      const { error: updateError } = await supabase
        .from(tableName)
        .update({ edited_bpmn_xml: null })
        .eq("id", entityId);

      if (updateError) throw updateError;

      // Reload original
      const { data, error: fetchError } = await supabase
        .from(tableName)
        .select("original_bpmn_xml")
        .eq("id", entityId)
        .single();

      if (fetchError) throw fetchError;

      if (data.original_bpmn_xml) {
        await loadXml(data.original_bpmn_xml);
        
        // Broadcast reset
        const bc = new BroadcastChannel("bpmn");
        bc.postMessage({ entityId, timestamp: Date.now(), tabId: tabIdRef.current });
        bc.close();
        
        toast.success("Reset to AI version");
      }
    } catch (err) {
      console.error("Error resetting:", err);
      toast.error("Failed to reset");
    }
  }, [entityId, tableName, loadXml]);

  return {
    modeler,
    loading,
    error,
    loadXml,
    saveXml,
    onChange,
    undo,
    reset,
    elementRegistry: modeler ? modeler.get("elementRegistry") : null,
    modeling: modeler ? modeler.get("modeling") : null,
    eventBus: modeler ? modeler.get("eventBus") : null,
    commandStack: modeler ? modeler.get("commandStack") : null,
  };
}
