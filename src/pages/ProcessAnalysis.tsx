import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft, Printer, Download } from "lucide-react";
import { toast } from "sonner";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import html2pdf from "html2pdf.js";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

const ProcessAnalysis = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [serviceName, setServiceName] = useState<string>("");
  const [analysis, setAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(true);

  const sanitizedHtml = useMemo(() => {
    if (!analysis) return "";
    const rawHtml = md.render(analysis);
    return DOMPurify.sanitize(rawHtml);
  }, [analysis]);

  useEffect(() => {
    const fetchServiceAndAnalyze = async () => {
      if (!id) {
        toast.error("Service ID is missing");
        navigate("/dashboard");
        return;
      }

      try {
        // Fetch service name
        const { data: service, error: serviceError } = await supabase
          .from("manual_services")
          .select("name")
          .eq("id", id)
          .single();

        if (serviceError || !service) {
          toast.error("Failed to fetch service details");
          navigate("/dashboard");
          return;
        }

        setServiceName(service.name);

        // Call edge function to analyze process
        const { data, error } = await supabase.functions.invoke("analyze-process", {
          body: { serviceId: id },
        });

        if (error) {
          console.error("Analysis error:", error);
          toast.error("Failed to analyze process");
          setAnalysis("Failed to generate analysis. Please try again.");
        } else {
          setAnalysis(data.analysis);
        }
      } catch (error) {
        console.error("Error:", error);
        toast.error("An unexpected error occurred");
        setAnalysis("An unexpected error occurred during analysis.");
      } finally {
        setIsAnalyzing(false);
      }
    };

    fetchServiceAndAnalyze();
  }, [id, navigate]);

  const handlePrint = () => {
    window.print();
  };

  const mdToDocxParagraphs = (markdownText: string) => {
    const lines = markdownText.split(/\r?\n/);
    const paras: Paragraph[] = [];

    for (const line of lines) {
      if (/^###\s+/.test(line)) {
        paras.push(
          new Paragraph({
            text: line.replace(/^###\s+/, ""),
            heading: HeadingLevel.HEADING_3,
          })
        );
      } else if (/^##\s+/.test(line)) {
        paras.push(
          new Paragraph({
            text: line.replace(/^##\s+/, ""),
            heading: HeadingLevel.HEADING_2,
          })
        );
      } else if (/^#\s+/.test(line)) {
        paras.push(
          new Paragraph({
            text: line.replace(/^#\s+/, ""),
            heading: HeadingLevel.HEADING_1,
          })
        );
      } else if (line.trim().length === 0) {
        paras.push(new Paragraph(""));
      } else {
        const parts = line.split(/(\*\*[^*]+\*\*)/g).map((part) => {
          const m = part.match(/^\*\*(.+)\*\*$/);
          return m
            ? new TextRun({ text: m[1], bold: true })
            : new TextRun({ text: part });
        });
        paras.push(new Paragraph({ children: parts }));
      }
    }
    return paras;
  };

  const downloadPdf = () => {
    const el = document.getElementById("analysis-content");
    if (!el) return;

    const opt = {
      margin: 10,
      filename: `Analysis-${serviceName || "Report"}.pdf`,
      image: { type: "jpeg" as const, quality: 0.98 },
      html2canvas: { scale: 2 },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" as const },
    };

    html2pdf().from(el).set(opt).save();
    toast.success("PDF download started");
  };

  const downloadDocx = async () => {
    try {
      const doc = new Document({
        sections: [
          {
            properties: {},
            children: [
              new Paragraph({
                text: `BPMN Process Analysis: ${serviceName}`,
                heading: HeadingLevel.TITLE,
              }),
              ...mdToDocxParagraphs(analysis),
            ],
          },
        ],
      });

      const blob = await Packer.toBlob(doc);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Analysis-${serviceName || "Report"}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("DOCX download started");
    } catch (error) {
      console.error("DOCX download error:", error);
      toast.error("Failed to download DOCX");
    }
  };

  const downloadMarkdown = () => {
    const blob = new Blob([analysis], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Analysis-${serviceName || "Report"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Markdown download started");
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 flex items-start justify-between gap-4 print:hidden">
          <h1 className="text-3xl font-bold mb-2">
            Analysis: {serviceName || "Loading..."}
          </h1>
          {!isAnalyzing && (
            <div className="flex items-center gap-2">
              <Button
                onClick={handlePrint}
                variant="outline"
                size="sm"
                className="gap-2"
              >
                <Printer className="h-4 w-4" />
                Print
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={downloadPdf}>
                    Download as PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadDocx}>
                    Download as DOCX
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={downloadMarkdown}>
                    Download as Markdown
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {isAnalyzing ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg text-muted-foreground">Analysing...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-card border rounded-lg p-6 print:border-0 print:shadow-none">
              <div
                id="analysis-content"
                className="analysis-content prose prose-sm max-w-none dark:prose-invert"
                dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
              />
            </div>

            <div className="flex justify-center pt-4 print:hidden">
              <Button
                onClick={() => navigate("/dashboard")}
                variant="outline"
                className="gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProcessAnalysis;
