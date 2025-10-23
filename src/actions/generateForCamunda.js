// /src/actions/generateForCamunda.js
// Minimal UI glue to call the core and start a ZIP download.

import { generateBundle } from '../../lib/formgen-core.js';
// eslint-disable-next-line import/no-extraneous-dependencies
import { saveAs } from 'file-saver';

export async function generateAndDownloadBundle ({
  serviceName,
  bpmnModeler,
  templates
}) {
  const { zipBinary, manifest } = await generateBundle({
    serviceName,
    bpmnModeler,
    templates
  });

  const blob = new Blob([zipBinary], { type: 'application/zip' });
  const outName = `${(serviceName || 'manual-service').replace(/\s+/g, '-')}-camunda-bundle.zip`;
  saveAs(blob, outName);

  return manifest; // for preview in the UI if you like
}
