import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Upload, ArrowLeft, FileText, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import * as XLSX from 'xlsx';

interface MDSRow {
  service_external_id: string;
  service_name: string;
  performing_team: string;
  performer_org: string;
  step_external_id: string;
  step_name: string;
  type: string;
  candidate_group?: string;
  document_urls?: string;
  document_name?: string;
  process_step?: number;
}

interface JobStatus {
  service_external_id: string;
  service_name: string;
  pdf_fetch_status: string;
  process_gen_status: string;
  pdf_fetch_progress?: string;
}

const MDSImport = () => {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<MDSRow[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [jobStatuses, setJobStatuses] = useState<JobStatus[]>([]);
  const [lastImportSummary, setLastImportSummary] = useState<{
    inserted: number;
    updated: number;
    skipped: number;
  } | null>(null);

  useEffect(() => {
    if (!roleLoading && !isAdmin) {
      toast.error("Access restricted to administrators");
      navigate("/dashboard");
    }
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    // Auto-refresh job statuses every 5 seconds
    const interval = setInterval(fetchJobStatuses, 5000);
    fetchJobStatuses();
    return () => clearInterval(interval);
  }, []);

  const fetchJobStatuses = async () => {
    try {
      const { data: jobs, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Group by service and take the most recent job per type
      const serviceMap = new Map<string, JobStatus>();
      
      for (const job of jobs || []) {
        if (!serviceMap.has(job.service_external_id)) {
          // Get service name
          const { data: mdsData } = await supabase
            .from('mds_data')
            .select('service_name')
            .eq('service_external_id', job.service_external_id)
            .limit(1)
            .single();

          serviceMap.set(job.service_external_id, {
            service_external_id: job.service_external_id,
            service_name: mdsData?.service_name || job.service_external_id,
            pdf_fetch_status: 'N/A',
            process_gen_status: 'N/A',
          });
        }

        const status = serviceMap.get(job.service_external_id)!;
        
        // Only set once per type (since jobs are sorted DESC, first seen is the latest)
        if (job.job_type === 'pdf_fetch' && (status.pdf_fetch_status === 'N/A' || !status.pdf_fetch_status)) {
          status.pdf_fetch_status = job.status;
          if (typeof job.total === 'number' && typeof job.progress === 'number') {
            status.pdf_fetch_progress = `${job.progress}/${job.total}`;
          }
        } else if (job.job_type === 'process_generation' && (status.process_gen_status === 'N/A' || !status.process_gen_status)) {
          status.process_gen_status = job.status;
        }
      }

      setJobStatuses(Array.from(serviceMap.values()));
    } catch (error) {
      console.error('Failed to fetch job statuses:', error);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const fileExtension = selectedFile.name.toLowerCase().split('.').pop();
    if (fileExtension !== 'csv' && fileExtension !== 'xlsx') {
      toast.error("Please upload a CSV or XLSX file");
      return;
    }

    if (selectedFile.size > 20 * 1024 * 1024) {
      toast.error("File too large (max 20 MB)");
      return;
    }

    setFile(selectedFile);

    try {
      let rows: MDSRow[] = [];

      if (fileExtension === 'csv') {
        const text = await selectedFile.text();
        rows = parseCSV(text);
      } else if (fileExtension === 'xlsx') {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        rows = parseWorksheetData(jsonData as any[][]);
      }

      console.log('Preview rows parsed:', rows);

      if (rows.length === 0) {
        toast.error("No valid data found. Please ensure the file has columns: Manual Service ID, Process Step ID, and other required fields.");
        return;
      }

      setParsedData(rows.slice(0, 10));
      toast.success(`Preview: First ${Math.min(rows.length, 10)} rows loaded`);
    } catch (error) {
      console.error('Parse error:', error);
      toast.error('Failed to parse file');
    }
  };

  const parseCSV = (text: string): MDSRow[] => {
    // Remove BOM if present
    text = text.replace(/^\ufeff/, '');
    
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return [];
    }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
    const rows: MDSRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/['"]/g, ''));
      const row = mapRowFromHeaders(headers, values);
      
      if (row.service_external_id && row.step_external_id) {
        rows.push(row);
      }
    }

    return rows;
  };

  const parseWorksheetData = (data: any[][]): MDSRow[] => {
    if (data.length < 2) {
      return [];
    }

    const headers = data[0].map((h: any) => String(h).trim().toLowerCase());
    const rows: MDSRow[] = [];

    for (let i = 1; i < data.length; i++) {
      const values = data[i].map((v: any) => String(v || '').trim());
      const row = mapRowFromHeaders(headers, values);
      
      if (row.service_external_id && row.step_external_id) {
        rows.push(row);
      }
    }

    return rows;
  };

  const mapRowFromHeaders = (headers: string[], values: string[]): MDSRow => {
    const row: any = {};
    
    headers.forEach((header, idx) => {
      const value = values[idx];
      
      // Manual Service ID or Service External ID
      if (header.includes('manual') && header.includes('service') && header.includes('id')) {
        row.service_external_id = value;
      } else if (header.includes('service') && header.includes('external')) {
        row.service_external_id = value;
      }
      
      // Manual Service Name or Service Name
      else if (header.includes('manual') && header.includes('service') && header.includes('name')) {
        row.service_name = value;
      } else if (header.includes('service') && header.includes('name') && !header.includes('performer')) {
        row.service_name = value;
      }
      
      // Process Step ID or Step External ID
      else if (header.includes('process') && header.includes('step') && header.includes('id')) {
        row.step_external_id = value;
      } else if (header.includes('step') && header.includes('external')) {
        row.step_external_id = value;
      }
      
      // Process Step Name or Step Name
      else if (header.includes('process') && header.includes('step') && header.includes('name')) {
        row.step_name = value;
      } else if (header.includes('step') && header.includes('name')) {
        row.step_name = value;
      }
      
      // Performing Team
      else if (header.includes('performing') && header.includes('team')) {
        row.performing_team = value;
      }
      
      // Service Performer Organisation or Performer Org
      else if (header.includes('service') && header.includes('performer') && header.includes('org')) {
        row.performer_org = value;
      } else if (header.includes('performer') && header.includes('org')) {
        row.performer_org = value;
      }
      
      // Type
      else if (header === 'type' && !header.includes('sop') && !header.includes('decision')) {
        row.type = value;
      }
      
      // Candidate Group
      else if (header.includes('candidate') && header.includes('group')) {
        row.candidate_group = value;
      }
      
      // Process Step (first step indicator)
      else if (header.includes('process') && header.includes('step') && !header.includes('id') && !header.includes('name')) {
        const numValue = parseInt(value);
        if (!isNaN(numValue)) {
          row.process_step = numValue;
        }
      }
      
      // SOP/Decision Sheet Name -> document_name
      else if ((header.includes('sop') || header.includes('decision')) && header.includes('sheet') && header.includes('name')) {
        row.document_name = value;
      }
      
      // URL to SOP/Decision Sheet -> document_urls
      else if (header.includes('url') && (header.includes('sop') || header.includes('decision'))) {
        row.document_urls = value;
      }
    });

    return row;
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Please select a file first");
      return;
    }

    setIsUploading(true);

    try {
      const fileExtension = file.name.toLowerCase().split('.').pop();
      let allRows: MDSRow[] = [];

      if (fileExtension === 'csv') {
        const text = await file.text();
        allRows = parseCSV(text);
      } else if (fileExtension === 'xlsx') {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        allRows = parseWorksheetData(jsonData as any[][]);
      }

      console.log('Parsed rows:', allRows);

      if (allRows.length === 0) {
        toast.error("No valid data found in file. Please ensure columns include: Manual Service ID, Process Step ID, and other required fields.");
        return;
      }

      // Validate required fields
      const invalidRows = allRows.filter(row => 
        !row.service_external_id || !row.service_name || 
        !row.step_external_id || !row.step_name ||
        !row.performing_team || !row.performer_org || !row.type
      );

      if (invalidRows.length > 0) {
        console.error('Invalid rows found:', invalidRows);
        toast.error(`Found ${invalidRows.length} rows with missing required fields. Check console for details.`);
        return;
      }

      // Call import edge function
      const { data, error } = await supabase.functions.invoke('mds-import', {
        body: { rows: allRows }
      });

      if (error) throw error;

      setLastImportSummary({
        inserted: data.inserted,
        updated: data.updated,
        skipped: data.skipped,
      });

      toast.success(`Import complete: ${data.inserted} inserted, ${data.updated} updated`);
      
      // Refresh job statuses
      await fetchJobStatuses();
      
      // Clear file
      setFile(null);
      setParsedData([]);
    } catch (error) {
      console.error('Import error:', error);
      toast.error(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setIsUploading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default:
        return <div className="w-4 h-4 rounded-full bg-gray-300" />;
    }
  };

  if (roleLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <h1 className="text-3xl font-bold">MDS Data Import</h1>
        </div>

        {/* Import Summary */}
        {lastImportSummary && (
          <Card className="p-6 mb-6 bg-green-50 border-green-200">
            <h2 className="text-lg font-semibold mb-2">Last Import Summary</h2>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Inserted</p>
                <p className="text-2xl font-bold text-green-600">{lastImportSummary.inserted}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Updated</p>
                <p className="text-2xl font-bold text-blue-600">{lastImportSummary.updated}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Skipped</p>
                <p className="text-2xl font-bold text-gray-600">{lastImportSummary.skipped}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Upload Section */}
        <Card className="p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Upload MDS File</h2>
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center">
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={handleFileChange}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground mb-2">
                  Click to upload CSV or XLSX (max 20 MB)
                </p>
                {file && (
                  <p className="text-sm font-medium">
                    <FileText className="w-4 h-4 inline mr-2" />
                    {file.name}
                  </p>
                )}
              </label>
            </div>

            {parsedData.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Preview (first 10 rows)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Service ID</th>
                        <th className="text-left p-2">Service Name</th>
                        <th className="text-left p-2">Step ID</th>
                        <th className="text-left p-2">Step Name</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-left p-2">Candidate Group</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedData.map((row, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-2">{row.service_external_id}</td>
                          <td className="p-2">{row.service_name}</td>
                          <td className="p-2">{row.step_external_id}</td>
                          <td className="p-2">{row.step_name}</td>
                          <td className="p-2">{row.type}</td>
                          <td className="p-2">{row.candidate_group || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Button
              onClick={handleImport}
              disabled={!file || isUploading}
              className="w-full"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import & Upsert'
              )}
            </Button>
          </div>
        </Card>

        {/* Job Progress */}
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Job Progress</h2>
          {jobStatuses.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No jobs yet</p>
          ) : (
            <div className="space-y-4">
              {jobStatuses.map((job) => (
                <div key={job.service_external_id} className="border rounded-lg p-4">
                  <h3 className="font-semibold mb-2">{job.service_name}</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.pdf_fetch_status)}
                      <div>
                        <p className="text-sm font-medium">PDF Fetch</p>
                        <p className="text-xs text-muted-foreground">
                          {job.pdf_fetch_status}
                          {job.pdf_fetch_progress && ` (${job.pdf_fetch_progress})`}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(job.process_gen_status)}
                      <div>
                        <p className="text-sm font-medium">Process Generation</p>
                        <p className="text-xs text-muted-foreground">{job.process_gen_status}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default MDSImport;
