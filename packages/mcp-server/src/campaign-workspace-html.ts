import {
  CAMPAIGN_WORKSPACE_APP_CSS,
  CAMPAIGN_WORKSPACE_APP_JAVASCRIPT,
} from "./campaign-workspace-assets.generated.ts";

export const CAMPAIGN_WORKSPACE_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DM Faster campaign workspace</title>
  <style>${CAMPAIGN_WORKSPACE_APP_CSS}</style>
</head>
<body>
  <div id="root" aria-live="polite"></div>
  <script>${CAMPAIGN_WORKSPACE_APP_JAVASCRIPT}</script>
</body>
</html>`;
