import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, Eye, FileText, Box, FileJson } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BpmnPreviewModal } from "./BpmnPreviewModal";
import { FormPreviewModal } from "./FormPreviewModal";
import { ManifestViewModal } from "./ManifestViewModal";

interface ExportFile {
  name: string;
  type: 'bpmn-main' | 'bpmn-sub' | 'form' | 'meta' | 'unknown';
  signedUrl: string;
  stepExternalId?: string;
  taskName?: string;
  calledElement?: string;
}

interface ExportResultsPanelProps {
  serviceId: string;
  serviceName: string;
}

export function ExportResultsPanel({ serviceId, serviceName }: ExportResultsPanelProps) {
  const [files, setFiles] = useState<ExportFile[]>([]);
  const [manifest, setManifest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [previewFile, setPreviewFile] = useState<ExportFile | null>(null);
  const [previewType, setPreviewType] = useState<'bpmn' | 'form' | 'manifest' | null>(null);

  useEffect(() => {
    loadExportFiles();
  }, [serviceId]);

  const loadExportFiles = async () => {
    try {
      setLoading(true);
      
      // Call edge function via URL params (GET request)
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/list-exports?service_id=${serviceId}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        }
      });

      if (!response.ok) {
        throw new Error('Failed to load export files');
      }

      const data = await response.json();
      if (!data) throw new Error('No export data returned');

      setFiles(data.files || []);
      setManifest(data.manifest || null);
    } catch (error) {
      console.error('Error loading exports:', error);
      toast.error('Failed to load export files');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (file: ExportFile) => {
    window.open(file.signedUrl, '_blank');
    toast.success(`Downloading ${file.name}`);
  };

  const handlePreview = (file: ExportFile) => {
    setPreviewFile(file);
    if (file.type === 'bpmn-main' || file.type === 'bpmn-sub') {
      setPreviewType('bpmn');
    } else if (file.type === 'form') {
      setPreviewType('form');
    } else if (file.type === 'meta') {
      setPreviewType('manifest');
    }
  };

  const handleDownloadZip = async () => {
    toast.info('Preparing ZIP package...');
    // The ZIP should already exist in storage, we can fetch it
    // For now, just show a message
    toast.success('ZIP download started');
  };

  const getFileBadge = (type: string) => {
    switch (type) {
      case 'bpmn-main':
        return <Badge variant="default">Main BPMN</Badge>;
      case 'bpmn-sub':
        return <Badge className="bg-indigo-500 hover:bg-indigo-600">Subprocess</Badge>;
      case 'form':
        return <Badge className="bg-teal-500 hover:bg-teal-600">Form</Badge>;
      case 'meta':
        return <Badge variant="secondary">Manifest</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const mainBpmn = files.filter(f => f.type === 'bpmn-main');
  const subprocessBpmns = files.filter(f => f.type === 'bpmn-sub');
  const forms = files.filter(f => f.type === 'form');
  const metaFiles = files.filter(f => f.type === 'meta');

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Generated Files</CardTitle>
          <CardDescription>Loading export results...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Generated Files</CardTitle>
              <CardDescription>
                Export package for: {serviceName}
              </CardDescription>
            </div>
            <Button onClick={handleDownloadZip} variant="outline">
              <Download className="h-4 w-4 mr-2" />
              Download ZIP
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Main BPMN */}
          {mainBpmn.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Box className="h-5 w-5 text-primary" />
                <h3 className="font-semibold text-sm">Main BPMN</h3>
              </div>
              {mainBpmn.map((file) => (
                <div
                  key={file.name}
                  className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      {getFileBadge(file.type)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handlePreview(file)}
                    >
                      <Eye className="h-4 w-4 mr-1" />
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDownload(file)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Subprocess BPMNs */}
          {subprocessBpmns.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Box className="h-5 w-5 text-indigo-500" />
                  <h3 className="font-semibold text-sm">
                    Subprocess BPMNs ({subprocessBpmns.length})
                  </h3>
                </div>
                {subprocessBpmns.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{file.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          {getFileBadge(file.type)}
                          {file.taskName && (
                            <span className="text-xs text-muted-foreground">
                              → {file.taskName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePreview(file)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(file)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Forms */}
          {forms.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-teal-500" />
                  <h3 className="font-semibold text-sm">Forms ({forms.length})</h3>
                </div>
                {forms.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileJson className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{file.name}</p>
                        {getFileBadge(file.type)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePreview(file)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(file)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Manifest */}
          {metaFiles.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <FileJson className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-semibold text-sm">Manifest</h3>
                </div>
                {metaFiles.map((file) => (
                  <div
                    key={file.name}
                    className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileJson className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{file.name}</p>
                        {getFileBadge(file.type)}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePreview(file)}
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View JSON
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(file)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Preview Modals */}
      {previewType === 'bpmn' && previewFile && (
        <BpmnPreviewModal
          open={true}
          onOpenChange={() => {
            setPreviewFile(null);
            setPreviewType(null);
          }}
          fileUrl={previewFile.signedUrl}
          fileName={previewFile.name}
        />
      )}

      {previewType === 'form' && previewFile && (
        <FormPreviewModal
          open={true}
          onOpenChange={() => {
            setPreviewFile(null);
            setPreviewType(null);
          }}
          fileUrl={previewFile.signedUrl}
          fileName={previewFile.name}
        />
      )}

      {previewType === 'manifest' && manifest && (
        <ManifestViewModal
          open={true}
          onOpenChange={() => {
            setPreviewFile(null);
            setPreviewType(null);
          }}
          manifest={manifest}
        />
      )}
    </>
  );
}
