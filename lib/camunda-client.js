/**
 * Camunda 8 Web Modeler API Client
 *
 * Provides methods to interact with Camunda 8's Web Modeler API:
 * - OAuth2 authentication
 * - Project creation
 * - File uploads (BPMN and Forms)
 */

/**
 * Camunda API Client for Web Modeler
 */
export class CamundaClient {
  constructor(config) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.oauthUrl = config.oauthUrl;
    this.audience = config.audience;
    this.modelerApiUrl = config.modelerApiUrl;

    this.accessToken = null;
    this.tokenExpiry = null;
  }

  /**
   * Authenticate with Camunda Console API and get access token
   */
  async authenticate() {
    try {
      console.log('[CamundaClient] Authenticating with Camunda Console API...');

      const response = await fetch(this.oauthUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
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

      // Set token expiry (subtract 60 seconds for safety margin)
      const expiresIn = data.expires_in || 3600;
      this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;

      console.log('[CamundaClient] Authentication successful');
      return this.accessToken;
    } catch (error) {
      console.error('[CamundaClient] Authentication error:', error);
      throw new Error(`Failed to authenticate with Camunda: ${error.message}`);
    }
  }

  /**
   * Ensure we have a valid access token
   */
  async ensureAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  /**
   * Make an authenticated API request
   */
  async apiRequest(method, endpoint, body = null) {
    await this.ensureAuthenticated();

    const url = `${this.modelerApiUrl}${endpoint}`;
    const options = {
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

  /**
   * Create a new project in Web Modeler
   * @param {string} name - Project name
   * @returns {Object} Created project with id, name, etc.
   */
  async createProject(name) {
    try {
      console.log(`[CamundaClient] Creating project: ${name}`);

      const project = await this.apiRequest('POST', '/projects', { name });

      console.log(`[CamundaClient] Project created: ${project.name} (ID: ${project.id})`);
      return project;
    } catch (error) {
      console.error('[CamundaClient] Project creation error:', error);
      throw new Error(`Failed to create project: ${error.message}`);
    }
  }

  /**
   * Upload a file to a project
   * @param {string} projectId - Project ID
   * @param {string} name - File name (e.g., "manual-service.bpmn")
   * @param {string} content - File content (XML for BPMN, JSON string for forms)
   * @param {string} fileType - File type: 'bpmn', 'form'
   * @returns {Object} Created file with id, name, etc.
   */
  async uploadFile(projectId, name, content, fileType) {
    try {
      console.log(`[CamundaClient] Uploading file: ${name} (type: ${fileType})`);

      const file = await this.apiRequest('POST', '/files', {
        projectId,
        name,
        content,
        fileType,
      });

      console.log(`[CamundaClient] File uploaded: ${file.name} (ID: ${file.id})`);
      return file;
    } catch (error) {
      console.error(`[CamundaClient] File upload error for ${name}:`, error);
      throw new Error(`Failed to upload file ${name}: ${error.message}`);
    }
  }

  /**
   * Upload multiple files with retry logic and rate limiting
   * @param {string} projectId - Project ID
   * @param {Array} files - Array of {name, content, fileType}
   * @param {number} maxRetries - Maximum retries per file
   * @returns {Object} Upload results
   */
  async uploadFiles(projectId, files, maxRetries = 3) {
    const results = {
      successful: [],
      failed: [],
    };

    // Rate limiting: 240 requests/minute = ~4 requests/second
    // We'll use a delay of 300ms between requests to be safe
    const delay = 300;

    for (const file of files) {
      let retries = 0;
      let success = false;

      while (retries < maxRetries && !success) {
        try {
          const result = await this.uploadFile(
            projectId,
            file.name,
            file.content,
            file.fileType
          );

          results.successful.push({
            name: file.name,
            fileId: result.id,
          });

          success = true;
        } catch (error) {
          retries++;
          console.error(
            `[CamundaClient] Upload attempt ${retries}/${maxRetries} failed for ${file.name}:`,
            error.message
          );

          if (retries < maxRetries) {
            // Exponential backoff: 1s, 2s, 4s
            const backoff = Math.pow(2, retries) * 1000;
            console.log(`[CamundaClient] Retrying in ${backoff}ms...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
          } else {
            results.failed.push({
              name: file.name,
              error: error.message,
            });
          }
        }
      }

      // Rate limiting delay between files
      if (success && files.indexOf(file) < files.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return results;
  }

  /**
   * Get project URL for the Web Modeler UI
   * @param {string} projectId - Project ID
   * @returns {string} URL to view the project in Web Modeler
   */
  getProjectUrl(projectId) {
    return `https://modeler.camunda.io/projects/${projectId}`;
  }
}

/**
 * Create a Camunda client instance from environment variables
 */
export function createCamundaClient(env) {
  return new CamundaClient({
    clientId: env.CAMUNDA_CONSOLE_CLIENT_ID,
    clientSecret: env.CAMUNDA_CONSOLE_CLIENT_SECRET,
    oauthUrl: env.CAMUNDA_OAUTH_URL,
    audience: env.CAMUNDA_CONSOLE_OAUTH_AUDIENCE,
    modelerApiUrl: env.CAMUNDA_MODELER_API_URL,
  });
}
