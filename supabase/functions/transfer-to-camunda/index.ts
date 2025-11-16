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

  async createProject(name: string) {
    console.log(`[CamundaClient] Creating project: ${name}`);
    const project = await this.apiRequest('POST', '/projects', { name });
    console.log(`[CamundaClient] Project created: ${project.name} (ID: ${project.id})`);
    return project;
  }

  async uploadFile(projectId: string, name: string, content: string, fileType: string) {
    console.log(`[CamundaClient] Uploading file: ${name} (type: ${fileType})`);
    const file = await this.apiRequest('POST', '/files', {
      projectId,
      name,
      content,
      fileType,
    });
    console.log(`[CamundaClient] File uploaded: ${file.name} (ID: ${file.id})`);
    return file;
  }

  getProjectUrl(projectId: string) {
    return `https://modeler.camunda.io/projects/${projectId}`;
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

    // Create project with unique name (service name + timestamp)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    const projectName = `${serviceName}_${timestamp}`;

    console.log(`[transfer-to-camunda] Creating Camunda project: ${projectName}`);
    const project = await camundaClient.createProject(projectName);

    // Prepare files to upload (exclude manifest)
    const filesToUpload = [];

    // Add main BPMN
    filesToUpload.push({
      name: 'manual-service.bpmn',
      content: updatedBpmnXml,
      fileType: 'bpmn',
    });

    // Add subprocess BPMNs
    for (const subprocess of subprocessBpmns || []) {
      filesToUpload.push({
        name: subprocess.filename,
        content: subprocess.xml,
        fileType: 'bpmn',
      });
    }

    // Add forms (convert JSON to string)
    for (const form of forms || []) {
      filesToUpload.push({
        name: form.filename,
        content: JSON.stringify(form.json, null, 2),
        fileType: 'form',
      });
    }

    console.log(`[transfer-to-camunda] Uploading ${filesToUpload.length} files...`);

    // Upload files with rate limiting and retry logic
    const uploadResults = {
      successful: [] as any[],
      failed: [] as any[],
    };

    const delay = 300; // 300ms between requests (safe for 240 req/min limit)
    const maxRetries = 3;

    for (const file of filesToUpload) {
      let retries = 0;
      let success = false;

      while (retries < maxRetries && !success) {
        try {
          const result = await camundaClient.uploadFile(
            project.id,
            file.name,
            file.content,
            file.fileType
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

    const projectUrl = camundaClient.getProjectUrl(project.id);

    console.log(`[transfer-to-camunda] Transfer completed`);
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
        filesUploaded: uploadResults.successful.length,
        filesFailed: uploadResults.failed.length,
        uploadDetails: {
          successful: uploadResults.successful,
          failed: uploadResults.failed,
        },
        message: success
          ? `Successfully transferred ${uploadResults.successful.length} files to Camunda`
          : `Transferred ${uploadResults.successful.length} files, ${uploadResults.failed.length} failed`,
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
