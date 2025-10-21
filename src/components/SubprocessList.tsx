import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

interface Subprocess {
  id: string;
  service_id: string;
  name: string;
}

interface SubprocessListProps {
  serviceId: string;
}

export function SubprocessList({ serviceId }: SubprocessListProps) {
  const navigate = useNavigate();
  const [subprocesses, setSubprocesses] = useState<Subprocess[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSubprocesses();
  }, [serviceId]);

  const fetchSubprocesses = async () => {
    try {
      const { data, error } = await supabase
        .from("subprocesses")
        .select("*")
        .eq("service_id", serviceId)
        .order("name", { ascending: true });

      if (error) throw error;
      setSubprocesses(data || []);
    } catch (error) {
      console.error("Error fetching subprocesses:", error);
      toast.error("Failed to load subprocesses");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">Loading subprocesses...</p>;
  }

  if (subprocesses.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No subprocesses found for this manual service.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {subprocesses.map((subprocess) => (
        <Card
          key={subprocess.id}
          className="p-4 hover:shadow-md transition-shadow cursor-pointer"
          onClick={() => navigate(`/subprocess/${subprocess.id}`)}
        >
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-foreground">{subprocess.name}</h4>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/subprocess/${subprocess.id}`);
              }}
            >
              Edit Subprocess
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
