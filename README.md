<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/749f14d0-a51d-4caa-9dee-e4e01a3f4e32

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`, then set `JWT_SECRET` and the LLM config
   (OpenAI-compatible: DeepSeek or Aliyun DashScope — see comments in `.env.example`)
3. Run the app:
   `npm run dev`
