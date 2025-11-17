# Camunda Transfer - Python Lambda Implementation Guide

This guide shows how to implement the Camunda file transfer logic as an AWS Lambda function in Python.

## Overview

This Lambda function:
1. Receives BPMN files, forms, and subprocess data via API Gateway
2. Authenticates with Camunda Web Modeler
3. Creates/finds a project and folder structure
4. Uploads all files to Camunda
5. Updates the PostgreSQL database with transfer timestamp

## Required Python Libraries

```bash
pip install requests psycopg2-binary python-dateutil
```

Or add to `requirements.txt`:
```
requests>=2.31.0
psycopg2-binary>=2.9.9
python-dateutil>=2.8.2
```

## Environment Variables

Configure these in AWS Lambda:

```
CAMUNDA_CLIENT_ID=your_client_id
CAMUNDA_CLIENT_SECRET=your_client_secret
CAMUNDA_OAUTH_URL=https://login.cloud.camunda.io/oauth/token
CAMUNDA_AUDIENCE=api.cloud.camunda.io
CAMUNDA_MODELER_API_URL=https://modeler.camunda.io/api/v1
CAMUNDA_TARGET_PROJECT_NAME=YourProjectName
DATABASE_HOST=your-rds-endpoint.amazonaws.com
DATABASE_PORT=5432
DATABASE_NAME=your_db_name
DATABASE_USER=your_db_user
DATABASE_PASSWORD=your_db_password
```

## Complete Implementation

### 1. CamundaClient Class (`camunda_client.py`)

```python
import os
import time
import json
from typing import Dict, List, Optional, Tuple
import requests
from datetime import datetime, timedelta

class CamundaClient:
    """Client for interacting with Camunda Web Modeler API"""
    
    def __init__(self, config: Dict[str, str]):
        self.client_id = config['client_id']
        self.client_secret = config['client_secret']
        self.oauth_url = config['oauth_url']
        self.audience = config['audience']
        self.modeler_api_url = config['modeler_api_url']
        
        self.access_token: Optional[str] = None
        self.token_expires_at: Optional[datetime] = None
    
    def authenticate(self) -> str:
        """Authenticate with Camunda and get access token"""
        print("[CamundaClient] Authenticating with Camunda OAuth...")
        
        response = requests.post(
            self.oauth_url,
            headers={'Content-Type': 'application/json'},
            json={
                'grant_type': 'client_credentials',
                'audience': self.audience,
                'client_id': self.client_id,
                'client_secret': self.client_secret
            }
        )
        
        if response.status_code != 200:
            raise Exception(f"Authentication failed: {response.status_code} - {response.text}")
        
        data = response.json()
        self.access_token = data['access_token']
        expires_in = data.get('expires_in', 3600)
        self.token_expires_at = datetime.now() + timedelta(seconds=expires_in - 60)
        
        print("[CamundaClient] Authentication successful")
        return self.access_token
    
    def ensure_authenticated(self):
        """Ensure we have a valid access token"""
        if not self.access_token or not self.token_expires_at or datetime.now() >= self.token_expires_at:
            self.authenticate()
    
    def api_request(self, method: str, endpoint: str, body: Optional[Dict] = None) -> Dict:
        """Make authenticated request to Camunda API"""
        self.ensure_authenticated()
        
        url = f"{self.modeler_api_url}{endpoint}"
        headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        }
        
        response = requests.request(method, url, headers=headers, json=body)
        
        if response.status_code not in [200, 201]:
            raise Exception(f"API request failed: {response.status_code} - {response.text}")
        
        return response.json() if response.text else {}
    
    def search_projects(self, name: str) -> List[Dict]:
        """Search for projects by name"""
        print(f"[CamundaClient] Searching for project: {name}")
        
        response = self.api_request('POST', '/projects/search', {
            'filter': {'name': name}
        })
        
        items = response.get('items', [])
        print(f"[CamundaClient] Found {len(items)} project(s)")
        return items
    
    def create_project(self, name: str) -> Dict:
        """Create a new project"""
        print(f"[CamundaClient] Creating project: {name}")
        
        project = self.api_request('POST', '/projects', {'name': name})
        print(f"[CamundaClient] Project created with ID: {project['id']}")
        return project
    
    def create_folder(self, project_id: str, folder_name: str) -> Dict:
        """Create a folder within a project"""
        print(f"[CamundaClient] Creating folder: {folder_name}")
        
        folder = self.api_request('POST', '/folders', {
            'name': folder_name,
            'projectId': project_id
        })
        print(f"[CamundaClient] Folder created with ID: {folder['id']}")
        return folder
    
    def upload_file(self, project_id: str, name: str, content: str, file_type: str, 
                   parent_id: Optional[str] = None) -> Dict:
        """Upload a single file (BPMN or form)"""
        print(f"[CamundaClient] Uploading {file_type}: {name}")
        
        payload = {
            'name': name,
            'projectId': project_id,
            'content': content
        }
        
        if parent_id:
            payload['parentId'] = parent_id
        
        file_result = self.api_request('POST', f'/files/{file_type}', payload)
        print(f"[CamundaClient] File uploaded with ID: {file_result['id']}")
        return file_result
    
    def upload_files(self, project_id: str, files: List[Dict], parent_id: Optional[str] = None,
                    max_retries: int = 3) -> Tuple[List[Dict], List[Dict]]:
        """Upload multiple files with retry logic and rate limiting"""
        successful = []
        failed = []
        
        for file_data in files:
            name = file_data['name']
            content = file_data['content']
            file_type = file_data['fileType']
            
            for attempt in range(max_retries):
                try:
                    result = self.upload_file(project_id, name, content, file_type, parent_id)
                    successful.append({'name': name, 'id': result['id']})
                    
                    # Rate limiting: 200ms between uploads
                    time.sleep(0.2)
                    break
                    
                except Exception as e:
                    if attempt < max_retries - 1:
                        wait_time = (attempt + 1) * 2
                        print(f"[CamundaClient] Retry {attempt + 1}/{max_retries} for {name} after {wait_time}s")
                        time.sleep(wait_time)
                    else:
                        error_msg = str(e)
                        print(f"[CamundaClient] Failed to upload {name}: {error_msg}")
                        failed.append({'name': name, 'error': error_msg})
        
        return successful, failed
    
    def get_project_url(self, project_id: str) -> str:
        """Generate URL to view project in Web Modeler"""
        return f"https://modeler.cloud.camunda.io/projects/{project_id}"


def create_camunda_client(env: Dict[str, str]) -> CamundaClient:
    """Factory function to create CamundaClient from environment variables"""
    return CamundaClient({
        'client_id': env['CAMUNDA_CLIENT_ID'],
        'client_secret': env['CAMUNDA_CLIENT_SECRET'],
        'oauth_url': env['CAMUNDA_OAUTH_URL'],
        'audience': env['CAMUNDA_AUDIENCE'],
        'modeler_api_url': env['CAMUNDA_MODELER_API_URL']
    })
```

### 2. Lambda Handler (`lambda_function.py`)

```python
import os
import json
import psycopg2
from datetime import datetime
from typing import Dict, Any
from camunda_client import create_camunda_client

def get_db_connection():
    """Create PostgreSQL database connection"""
    return psycopg2.connect(
        host=os.environ['DATABASE_HOST'],
        port=os.environ.get('DATABASE_PORT', '5432'),
        database=os.environ['DATABASE_NAME'],
        user=os.environ['DATABASE_USER'],
        password=os.environ['DATABASE_PASSWORD']
    )

def update_transfer_timestamp(service_id: str):
    """Update last_camunda_transfer timestamp in database"""
    conn = None
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute(
            """
            UPDATE manual_services 
            SET last_camunda_transfer = %s 
            WHERE id = %s
            """,
            (datetime.utcnow(), service_id)
        )
        
        conn.commit()
        print(f"[Lambda] Updated last_camunda_transfer for service {service_id}")
        
    except Exception as e:
        print(f"[Lambda] Error updating timestamp: {str(e)}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for Camunda file transfer
    
    Expected event structure:
    {
        "serviceId": "uuid",
        "serviceName": "Service Name",
        "updatedBpmnXml": "<bpmn xml content>",
        "forms": [
            {
                "name": "form-name.form",
                "content": "{json content}"
            }
        ],
        "subprocessBpmns": [
            {
                "name": "subprocess-name.bpmn",
                "content": "<bpmn xml content>"
            }
        ],
        "manifest": {
            "serviceId": "...",
            "serviceName": "...",
            ...
        }
    }
    """
    
    print("[Lambda] Starting Camunda transfer")
    
    try:
        # Parse request body (for API Gateway)
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event
        
        service_id = body['serviceId']
        service_name = body['serviceName']
        updated_bpmn_xml = body['updatedBpmnXml']
        forms = body.get('forms', [])
        subprocess_bpmns = body.get('subprocessBpmns', [])
        manifest = body.get('manifest', {})
        
        print(f"[Lambda] Processing service: {service_name} (ID: {service_id})")
        print(f"[Lambda] Files: 1 main BPMN, {len(subprocess_bpmns)} subprocesses, {len(forms)} forms")
        
        # Initialize Camunda client
        camunda_client = create_camunda_client(os.environ)
        
        # Get or create project
        target_project_name = os.environ.get('CAMUNDA_TARGET_PROJECT_NAME', 'DemoProject')
        projects = camunda_client.search_projects(target_project_name)
        
        if projects:
            project = projects[0]
            print(f"[Lambda] Using existing project: {project['name']}")
        else:
            project = camunda_client.create_project(target_project_name)
            print(f"[Lambda] Created new project: {project['name']}")
        
        # Create folder with timestamp
        now = datetime.now()
        timestamp = now.strftime('%Y%m%d-%H%M')
        folder_name = f"{service_name} {timestamp}"
        
        print(f"[Lambda] Creating folder: {folder_name}")
        folder = camunda_client.create_folder(project['id'], folder_name)
        
        # Prepare files for upload
        files_to_upload = []
        
        # Main BPMN
        files_to_upload.append({
            'name': f"{service_name}.bpmn",
            'content': updated_bpmn_xml,
            'fileType': 'bpmn'
        })
        
        # Subprocess BPMNs
        for subprocess in subprocess_bpmns:
            files_to_upload.append({
                'name': subprocess['name'],
                'content': subprocess['content'],
                'fileType': 'bpmn'
            })
        
        # Forms
        for form in forms:
            files_to_upload.append({
                'name': form['name'],
                'content': form['content'],
                'fileType': 'form'
            })
        
        # Manifest as form
        if manifest:
            files_to_upload.append({
                'name': 'manifest.form',
                'content': json.dumps(manifest, indent=2),
                'fileType': 'form'
            })
        
        # Upload all files
        print(f"[Lambda] Uploading {len(files_to_upload)} files...")
        successful, failed = camunda_client.upload_files(
            project['id'],
            files_to_upload,
            parent_id=folder['id'],
            max_retries=3
        )
        
        print(f"[Lambda] Upload complete: {len(successful)} successful, {len(failed)} failed")
        
        # Update database timestamp
        update_transfer_timestamp(service_id)
        
        # Prepare response
        project_url = camunda_client.get_project_url(project['id'])
        
        response_body = {
            'success': len(failed) == 0,
            'projectId': project['id'],
            'projectName': project['name'],
            'projectUrl': project_url,
            'folderId': folder['id'],
            'folderName': folder['name'],
            'uploadedFiles': len(successful),
            'failedFiles': len(failed),
            'failures': failed
        }
        
        status_code = 200 if len(failed) == 0 else 207  # 207 = Multi-Status
        
        return {
            'statusCode': status_code,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(response_body)
        }
        
    except Exception as e:
        error_message = str(e)
        print(f"[Lambda] Error: {error_message}")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': False,
                'error': error_message
            })
        }
```

## Deployment Steps

### 1. Package the Lambda Function

```bash
# Create deployment package
mkdir lambda_package
cd lambda_package

# Copy your code
cp /path/to/camunda_client.py .
cp /path/to/lambda_function.py .

# Install dependencies
pip install -r requirements.txt -t .

# Create ZIP
zip -r ../camunda_transfer.zip .
```

### 2. Create Lambda Function in AWS Console

1. Go to AWS Lambda console
2. Create new function
3. Runtime: Python 3.11 or 3.12
4. Upload `camunda_transfer.zip`
5. Set handler: `lambda_function.lambda_handler`
6. Configure environment variables (see above)
7. Set timeout: 60 seconds (or more for large uploads)
8. Set memory: 512 MB (adjust as needed)

### 3. Configure VPC (for RDS Access)

If your PostgreSQL RDS is in a VPC:
1. In Lambda configuration, enable VPC
2. Select same VPC as your RDS
3. Select subnets
4. Select security group that allows PostgreSQL access

### 4. Create API Gateway Trigger

1. Add trigger: API Gateway
2. Create new REST API
3. Security: IAM / API Key / Open (your choice)
4. Note the API endpoint URL

## Testing

### Test Event (Lambda Console)

```json
{
  "serviceId": "123e4567-e89b-12d3-a456-426614174000",
  "serviceName": "Test Service",
  "updatedBpmnXml": "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<bpmn:definitions xmlns:bpmn=\"http://www.omg.org/spec/BPMN/20100524/MODEL\">\n  <bpmn:process id=\"Process_1\" isExecutable=\"true\">\n    <bpmn:startEvent id=\"StartEvent_1\" />\n  </bpmn:process>\n</bpmn:definitions>",
  "forms": [
    {
      "name": "test-form.form",
      "content": "{\"components\":[{\"type\":\"textfield\",\"key\":\"name\",\"label\":\"Name\"}],\"type\":\"default\",\"schemaVersion\":16}"
    }
  ],
  "subprocessBpmns": [],
  "manifest": {
    "serviceId": "123e4567-e89b-12d3-a456-426614174000",
    "serviceName": "Test Service"
  }
}
```

### Test via curl (API Gateway)

```bash
curl -X POST https://your-api-id.execute-api.region.amazonaws.com/prod/transfer \
  -H "Content-Type: application/json" \
  -d @test-payload.json
```

## Database Schema Requirements

Your PostgreSQL database needs a `manual_services` table with at least:

```sql
CREATE TABLE IF NOT EXISTS manual_services (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    last_camunda_transfer TIMESTAMP WITH TIME ZONE
);
```

## Error Handling

The Lambda function handles:
- Authentication failures
- Network timeouts
- File upload retries (3 attempts)
- Database connection errors
- Invalid request data

Check CloudWatch Logs for detailed error messages.

## Performance Considerations

- **Rate Limiting**: 200ms delay between file uploads
- **Retries**: 3 attempts with exponential backoff (2s, 4s, 6s)
- **Token Caching**: OAuth token reused until expiration
- **Batch Processing**: All files uploaded in one Lambda invocation

## Security Best Practices

1. Store credentials in AWS Secrets Manager (instead of env vars)
2. Use IAM roles for Lambda execution
3. Encrypt environment variables
4. Use VPC endpoints for RDS access
5. Enable CloudWatch Logs encryption
6. Restrict API Gateway access with API keys or IAM

## Monitoring

Key metrics to monitor:
- Lambda duration (should be < 30s for normal uploads)
- Lambda errors
- API Gateway 4xx/5xx errors
- Database connection pool exhaustion
- Camunda API rate limit errors

## Next Steps

1. Test locally with sample data
2. Deploy to AWS Lambda
3. Test via API Gateway
4. Monitor CloudWatch Logs
5. Adjust timeout/memory as needed
6. Implement Secrets Manager for credentials
7. Add CloudWatch alarms for errors

## Questions?

If you need help with:
- AWS Lambda configuration
- PostgreSQL connection pooling
- Error handling improvements
- Performance optimization

Feel free to reach out!
