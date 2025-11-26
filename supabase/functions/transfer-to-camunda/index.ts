import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.76.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FormData {
  filename: string;
  json: any;
}

interface SubprocessBpmn {
  filename: string;
  xml: string;
}

interface TransferRequest {
  serviceId: string;
  serviceName: string;
  updatedBpmnXml: string;
  forms: FormData[];
  subprocessBpmns: SubprocessBpmn[];
  manifest?: any;
}

/**
 * Camunda API Client for Web Modeler
 */
class CamundaClient {
  private clientId: string;
  private clientSecret: string;
  private oauthUrl: string;
  private audience: string;
  private modelerApiUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry: number | null = null;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    oauthUrl: string;
    audience: string;
    modelerApiUrl: string;
  }) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.oauthUrl = config.oauthUrl;
    this.audience = config.audience;
    this.modelerApiUrl = config.modelerApiUrl;
  }

  async authenticate() {
    console.log('[CamundaClient] Authenticating...');

    const response = await fetch(this.oauthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        audience: this.audience,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Authentication failed: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    this.accessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;
    this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;

    console.log('[CamundaClient] Authentication successful');
    return this.accessToken;
  }

  async ensureAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  async apiRequest(method: string, endpoint: string, body: any = null) {
    await this.ensureAuthenticated();

    const url = `${this.modelerApiUrl}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    console.log(`[CamundaClient] ${method} ${url}`);
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API request failed: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  async searchProjects(name?: string) {
    console.log(`[CamundaClient] Searching projects...`);
    const body = name ? { filter: { name } } : {};
    const result = await this.apiRequest('POST', '/projects/search', body);
    console.log(`[CamundaClient] Found ${result.items?.length || 0} projects`);
    return result.items || [];
  }

  async createProject(name: string) {
    console.log(`[CamundaClient] Creating project: ${name}`);
    const project = await this.apiRequest('POST', '/projects', { name });
    console.log(`[CamundaClient] Project created: ${project.name} (ID: ${project.id})`);
    return project;
  }

  async createFolder(projectId: string, name: string, parentId?: string) {
    console.log(`[CamundaClient] Creating folder: ${name}`);
    const folder = await this.apiRequest('POST', '/folders', {
      projectId,
      name,
      parentId,
    });
    console.log(`[CamundaClient] Folder created: ${folder.name} (ID: ${folder.id})`);
    return folder;
  }

  async uploadFile(projectId: string, name: string, content: string, fileType: string, folderId?: string) {
    console.log(`[CamundaClient] Uploading file: ${name} (type: ${fileType})`);
    const file = await this.apiRequest('POST', '/files', {
      projectId,
      name,
      content,
      fileType,
      ...(folderId && { folderId }),
    });
    console.log(`[CamundaClient] File uploaded: ${file.name} (ID: ${file.id})`);
    return file;
  }

  getProjectUrl(projectId: string) {
    return `https://modeler.camunda.io/projects/${projectId}`;
  }

  getFolderUrl(projectId: string, folderId: string) {
    return `https://modeler.camunda.io/projects/${projectId}/folder/${folderId}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('[transfer-to-camunda] Request received');

    const body: TransferRequest = await req.json();
    const { serviceId, serviceName, updatedBpmnXml, forms, subprocessBpmns } = body;

    if (!serviceId || !serviceName || !updatedBpmnXml) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: serviceId, serviceName, or updatedBpmnXml' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[transfer-to-camunda] Processing transfer for service: ${serviceName} (${serviceId})`);
    console.log(`[transfer-to-camunda] Forms count: ${forms?.length || 0}, Subprocesses: ${subprocessBpmns?.length || 0}`);

    // Initialize Camunda client
    const camundaClient = new CamundaClient({
      clientId: Deno.env.get('CAMUNDA_CONSOLE_CLIENT_ID')!,
      clientSecret: Deno.env.get('CAMUNDA_CONSOLE_CLIENT_SECRET')!,
      oauthUrl: Deno.env.get('CAMUNDA_OAUTH_URL')!,
      audience: Deno.env.get('CAMUNDA_CONSOLE_OAUTH_AUDIENCE')!,
      modelerApiUrl: Deno.env.get('CAMUNDA_MODELER_API_URL')!,
    });

    // Use existing project or create new one
    const targetProjectName = Deno.env.get('CAMUNDA_TARGET_PROJECT_NAME') || 'Manual Service Models';
    console.log(`[transfer-to-camunda] Looking for project: ${targetProjectName}`);

    const projects = await camundaClient.searchProjects(targetProjectName);
    let project = projects.find((p: any) => p.name === targetProjectName);

    if (!project) {
      console.log(`[transfer-to-camunda] Project "${targetProjectName}" not found, creating it...`);
      project = await camundaClient.createProject(targetProjectName);
    } else {
      console.log(`[transfer-to-camunda] Using existing project: ${project.name} (ID: ${project.id})`);
    }

    // Create folder structure:
    // Main folder: [Manual Service Name] [Manual Service ID]
    //   └─ Export folder: [Manual Service Name] [Timestamp]
    //      ├─ High Level (main BPMN + forms)
    //      └─ Low Level (subprocess BPMNs)
    
    const mainFolderName = `${serviceName} ${serviceId}`;
    console.log(`[transfer-to-camunda] Creating/finding main folder: ${mainFolderName}`);
    const mainFolder = await camundaClient.createFolder(project.id, mainFolderName);

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const exportFolderName = `${serviceName} ${timestamp}`;
    
    console.log(`[transfer-to-camunda] Creating export folder: ${exportFolderName}`);
    const exportFolder = await camundaClient.createFolder(project.id, exportFolderName, mainFolder.id);

    console.log(`[transfer-to-camunda] Creating High Level and Low Level subfolders`);
    const highLevelFolder = await camundaClient.createFolder(project.id, 'High Level', exportFolder.id);
    const lowLevelFolder = await camundaClient.createFolder(project.id, 'Low Level', exportFolder.id);

    // Prepare files to upload to High Level folder (main BPMN + forms)
    const highLevelFiles = [];

    // Add main BPMN to High Level
    highLevelFiles.push({
      name: 'manual-service.bpmn',
      content: updatedBpmnXml,
      fileType: 'bpmn',
      folderId: highLevelFolder.id,
    });

    // Add forms to High Level (convert JSON to string)
    for (const form of forms || []) {
      highLevelFiles.push({
        name: form.filename,
        content: JSON.stringify(form.json, null, 2),
        fileType: 'form',
        folderId: highLevelFolder.id,
      });
    }

    // Prepare subprocess BPMNs for Low Level folder
    const lowLevelFiles = [];
    for (const subprocess of subprocessBpmns || []) {
      lowLevelFiles.push({
        name: subprocess.filename,
        content: subprocess.xml,
        fileType: 'bpmn',
        folderId: lowLevelFolder.id,
      });
    }

    // Combine all files for upload
    const filesToUpload = [...highLevelFiles, ...lowLevelFiles];

    console.log(`[transfer-to-camunda] Uploading ${filesToUpload.length} files...`);

    // Upload files with rate limiting and retry logic
    const uploadResults = {
      successful: [] as any[],
      failed: [] as any[],
    };

    const delay = 300; // 300ms between requests (safe for 240 req/min limit)
    const maxRetries = 3;

    for (const file of filesToUpload) {
      const contentStr = typeof file.content === 'string' ? file.content : '';
      if (!contentStr || contentStr.trim().length === 0) {
        console.warn(`[transfer-to-camunda] Skipping upload for ${file.name} due to empty content`);
        uploadResults.failed.push({ name: file.name, error: 'Empty content' });
        continue;
      }

      let retries = 0;
      let success = false;

      while (retries < maxRetries && !success) {
        try {
          const result = await camundaClient.uploadFile(
            project.id,
            file.name,
            contentStr,
            file.fileType,
            file.folderId
          );

          uploadResults.successful.push({
            name: file.name,
            fileId: result.id,
          });

          success = true;
        } catch (error) {
          retries++;
          console.error(
            `[transfer-to-camunda] Upload attempt ${retries}/${maxRetries} failed for ${file.name}:`,
            error
          );

          if (retries < maxRetries) {
            const backoff = Math.pow(2, retries) * 1000;
            console.log(`[transfer-to-camunda] Retrying in ${backoff}ms...`);
            await new Promise((resolve) => setTimeout(resolve, backoff));
          } else {
            uploadResults.failed.push({
              name: file.name,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      // Rate limiting delay
      if (success && filesToUpload.indexOf(file) < filesToUpload.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const exportFolderUrl = camundaClient.getFolderUrl(project.id, exportFolder.id);
    const projectUrl = camundaClient.getProjectUrl(project.id);

    console.log(`[transfer-to-camunda] Transfer completed`);
    console.log(`[transfer-to-camunda] Project: ${project.name} (${project.id})`);
    console.log(`[transfer-to-camunda] Main folder: ${mainFolder.name} (${mainFolder.id})`);
    console.log(`[transfer-to-camunda] Export folder: ${exportFolder.name} (${exportFolder.id})`);
    console.log(`[transfer-to-camunda] High Level files: ${highLevelFiles.length}`);
    console.log(`[transfer-to-camunda] Low Level files: ${lowLevelFiles.length}`);
    console.log(`[transfer-to-camunda] Successful uploads: ${uploadResults.successful.length}`);
    console.log(`[transfer-to-camunda] Failed uploads: ${uploadResults.failed.length}`);

    // Update service timestamp
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase
      .from('manual_services')
      .update({
        last_camunda_transfer: new Date().toISOString(),
      })
      .eq('id', serviceId);

    // Return results
    const success = uploadResults.failed.length === 0;

    return new Response(
      JSON.stringify({
        success,
        projectId: project.id,
        projectName: project.name,
        projectUrl,
        mainFolderId: mainFolder.id,
        mainFolderName: mainFolder.name,
        exportFolderId: exportFolder.id,
        exportFolderName: exportFolder.name,
        exportFolderUrl,
        highLevelFolderId: highLevelFolder.id,
        lowLevelFolderId: lowLevelFolder.id,
        filesUploaded: uploadResults.successful.length,
        filesFailed: uploadResults.failed.length,
        uploadDetails: {
          successful: uploadResults.successful,
          failed: uploadResults.failed,
        },
        message: success
          ? `Successfully transferred ${uploadResults.successful.length} files to ${project.name}/${mainFolder.name}/${exportFolder.name}`
          : `Transferred ${uploadResults.successful.length} files to ${project.name}/${mainFolder.name}/${exportFolder.name}, ${uploadResults.failed.length} failed`,
      }),
      {
        status: success ? 200 : 207, // 207 Multi-Status for partial success
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[transfer-to-camunda] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        details: String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
