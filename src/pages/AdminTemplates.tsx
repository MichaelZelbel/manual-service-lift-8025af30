import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Upload, Download, Trash2, FileText, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { useUserRole } from "@/hooks/useUserRole";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Template name to filename mapping
const TEMPLATE_MAP: Record<string, string> = {
  FIRST_STEP_SINGLE: 'first-step-single-path.form',
  FIRST_STEP_MULTI: 'first-step-multi-path.form',
  NEXT_STEP_SINGLE: 'next-step-single-path.form',
  NEXT_STEP_MULTI: 'next-step-multi-path.form',
};

const DISPLAY_NAMES: Record<string, string> = {
  FIRST_STEP_SINGLE: 'First Step, Single Path',
  FIRST_STEP_MULTI: 'First Step, Multi Path',
  NEXT_STEP_SINGLE: 'Next Step, Single Path',
  NEXT_STEP_MULTI: 'Next Step, Multi Path',
};

interface FormTemplate {
  id: string;
  template_name: string;
  file_name: string;
  last_updated: string;
  uploaded_by: string | null;
}

export default function AdminTemplates() {
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading, userId } = useUserRole();
  const [templates, setTemplates] = useState<FormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<FormTemplate | null>(null);

  useEffect(() => {
    if (!roleLoading) {
      if (!isAdmin) {
        toast.error("Access restricted to administrators");
        navigate("/dashboard");
      }
    }
  }, [isAdmin, roleLoading, navigate]);

  useEffect(() => {
    if (isAdmin) {
      fetchTemplates();
    }
  }, [isAdmin]);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from("form_templates")
        .select("*")
        .order("template_name", { ascending: true });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
      toast.error("Failed to load templates");
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile || !selectedTemplate || !userId) {
      toast.error("Please select a template and file");
      return;
    }

    // Validate file size (max 2MB)
    if (uploadFile.size > 2 * 1024 * 1024) {
      toast.error("File too large (max 2 MB)");
      return;
    }

    // Validate file type
    const fileType = uploadFile.type;
    if (fileType !== 'application/json' && fileType !== 'text/plain') {
      toast.error("Unsupported file type. Upload a Camunda Webform JSON (.form/.json)");
      return;
    }

    setUploading(true);

    try {
      // Find the template record
      const template = templates.find((t) => DISPLAY_NAMES[t.template_name] === selectedTemplate);
      if (!template) {
        throw new Error("Template not found");
      }

      // Get current user info
      const storedUser = localStorage.getItem("currentUser");
      const user = storedUser ? JSON.parse(storedUser) : null;
      const uploadedBy = user ? `${user.name} (${user.bNumber})` : "Unknown";

      // Create FormData
      const formData = new FormData();
      formData.append('template_name', template.template_name);
      formData.append('file', uploadFile);
      formData.append('uploaded_by', uploadedBy);

      console.log('Uploading template:', template.template_name);

      // Call edge function
      const { data, error } = await supabase.functions.invoke('upload-template', {
        body: formData,
      });

      if (error) {
        throw new Error(error.message || 'Upload failed');
      }

      if (!data.ok) {
        throw new Error(data.error || 'Upload failed');
      }

      setUploadSuccess(true);
      toast.success(`Template "${data.display_name}" updated successfully`);

      // Refresh templates
      await fetchTemplates();

      // Reset and close modal after animation
      setTimeout(() => {
        setUploadModalOpen(false);
        setUploadSuccess(false);
        setSelectedTemplate("");
        setUploadFile(null);
      }, 1500);
    } catch (error) {
      console.error("Error uploading template:", error);
      toast.error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (template: FormTemplate) => {
    try {
      if (!template.uploaded_by) {
        toast.error("No file uploaded for this template yet");
        return;
      }

      console.log('Downloading template:', template.template_name);

      // Build URL with query params
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const downloadUrl = `${supabaseUrl}/functions/v1/download-template?template_name=${encodeURIComponent(template.template_name)}`;

      // Fetch signed URL
      const response = await fetch(downloadUrl);
      const data = await response.json();

      if (!response.ok || !data.ok || !data.signed_url) {
        throw new Error(data.error || 'Failed to generate download URL');
      }

      // Open signed URL in new tab
      window.open(data.signed_url, '_blank');
      toast.success("Template download started");
    } catch (error) {
      console.error("Error downloading template:", error);
      toast.error(`Download failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleDelete = async () => {
    if (!templateToDelete || !templateToDelete.uploaded_by) return;

    try {
      console.log('Deleting template:', templateToDelete.template_name);

      // Call edge function
      const { data, error } = await supabase.functions.invoke('delete-template', {
        body: { template_name: templateToDelete.template_name },
      });

      if (error) {
        throw new Error(error.message || 'Delete failed');
      }

      if (!data.ok) {
        throw new Error(data.error || 'Delete failed');
      }

      toast.success("Template deleted successfully");
      await fetchTemplates();
    } catch (error) {
      console.error("Error deleting template:", error);
      toast.error(`Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    }
  };

  if (roleLoading || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background animate-fade-in">
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/dashboard")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-2xl font-semibold text-foreground">
                Manage Form Templates
              </h1>
            </div>
            <Button onClick={() => setUploadModalOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Upload New Template
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Form Templates</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Template Name</TableHead>
                  <TableHead>File Name</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((template) => (
                  <TableRow key={template.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">{DISPLAY_NAMES[template.template_name]}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.file_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {template.uploaded_by
                        ? formatDistanceToNow(new Date(template.last_updated), {
                            addSuffix: true,
                          })
                        : "Not uploaded"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedTemplate(DISPLAY_NAMES[template.template_name]);
                            setUploadModalOpen(true);
                          }}
                          disabled={uploading}
                        >
                          {uploading && selectedTemplate === DISPLAY_NAMES[template.template_name] ? (
                            <>
                              <span className="animate-spin mr-2">⏳</span>
                              Uploading...
                            </>
                          ) : (
                            "Replace"
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(template)}
                          disabled={!template.uploaded_by}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setTemplateToDelete(template);
                            setDeleteDialogOpen(true);
                          }}
                          disabled={!template.uploaded_by}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>

      {/* Upload Modal */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Upload Form Template</DialogTitle>
            <DialogDescription>
              Select a template slot and upload a JSON or .form file.
            </DialogDescription>
          </DialogHeader>

          {uploadSuccess ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <CheckCircle2 className="h-16 w-16 text-green-600 animate-scale-in" />
              <p className="text-lg font-semibold text-foreground">
                Template uploaded successfully!
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="template-select">Template Slot</Label>
                <Select value={selectedTemplate} onValueChange={setSelectedTemplate}>
                  <SelectTrigger id="template-select">
                    <SelectValue placeholder="Select a template..." />
                  </SelectTrigger>
                  <SelectContent>
                    {templates.map((template) => (
                      <SelectItem key={template.id} value={DISPLAY_NAMES[template.template_name]}>
                        {DISPLAY_NAMES[template.template_name]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="file-upload">File Upload</Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".json,.form"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                />
                <p className="text-xs text-muted-foreground">
                  Accepted formats: .json, .form
                </p>
              </div>
            </div>
          )}

          {!uploadSuccess && (
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setUploadModalOpen(false);
                  setSelectedTemplate("");
                  setUploadFile(null);
                }}
                disabled={uploading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!uploadFile || !selectedTemplate || uploading}
              >
                {uploading ? "Uploading..." : "Upload"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template File?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the uploaded file for "{templateToDelete && DISPLAY_NAMES[templateToDelete.template_name]}".
              The template slot will remain and can be re-uploaded later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
