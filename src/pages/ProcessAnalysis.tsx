import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

const ProcessAnalysis = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [serviceName, setServiceName] = useState<string>("");
  const [analysis, setAnalysis] = useState<string>("");
  const [isAnalyzing, setIsAnalyzing] = useState(true);

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

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">
            Analysis: {serviceName || "Loading..."}
          </h1>
        </div>

        {isAnalyzing ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
            <p className="text-lg text-muted-foreground">Analysing...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="bg-card border rounded-lg p-6">
              <div 
                className="prose prose-sm max-w-none dark:prose-invert"
                style={{ lineHeight: 1.5 }}
              >
                {analysis.split('\n').map((line, idx) => {
                  // Handle markdown-style headers
                  if (line.startsWith('### ')) {
                    return <h3 key={idx} className="text-xl font-semibold mt-6 mb-3">{line.replace('### ', '')}</h3>;
                  } else if (line.startsWith('## ')) {
                    return <h2 key={idx} className="text-2xl font-bold mt-8 mb-4">{line.replace('## ', '')}</h2>;
                  } else if (line.startsWith('# ')) {
                    return <h1 key={idx} className="text-3xl font-bold mt-8 mb-4">{line.replace('# ', '')}</h1>;
                  } else if (line.startsWith('- ') || line.startsWith('* ')) {
                    return <li key={idx} className="ml-6">{line.substring(2)}</li>;
                  } else if (line.match(/^\d+\. /)) {
                    return <li key={idx} className="ml-6 list-decimal">{line.replace(/^\d+\. /, '')}</li>;
                  } else if (line.trim() === '') {
                    return <br key={idx} />;
                  } else {
                    return <p key={idx} className="mb-3">{line}</p>;
                  }
                })}
              </div>
            </div>

            <div className="flex justify-center pt-4">
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
