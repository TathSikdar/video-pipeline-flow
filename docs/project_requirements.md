# Video Pipeline Flow — Requirements & Evaluation

## 1. Project Requirements

### Core Pipeline
- Build automated flow downloading 5 or more short YouTube videos serially.
- Re-upload processed videos to target destination.
- Handle YouTube anti-bot defense, proxy switching, and rate limit blocks.

### Architecture & UI
- **Split Architecture**: Implement decoupled frontend and backend. 
- **Modern UI**: Interface clean, responsive, modern.
- **No User Auth**: End-user use tool without signing into YouTube/Google account. Download uses unauthenticated client-spoofing workarounds.
- **Automated Upload Identity**: Backend execute upload stage automatically using OAuth2 `refresh_token` credential pool. User zero-friction pipeline execution.
- **Privacy & Feedback**: Uploaded videos MUST set privacy status to `unlisted`. Backend capture video ID from API response, construct watch URL, send link to UI text loop.

### Quota Constraints & Pooling
- 10,000 daily quota limit bound strictly to GCP project tier, not target channel.
- Multiple channels bound to single GCP project share same 10,000 unit pool. 
- MUST implement credential pooling architecture supporting multiple separate GCP projects to scale past single-project threshold.
- Backend upload worker must dynamically load-balance requests and rotate OAuth2 tokens upon detecting `quotaExceeded` API error payload.

### Deployment Target
- Hosted on a Dedicated Virtual Private Server (VPS) with root access (e.g., Hetzner, DigitalOcean) to allow for kernel-level IPv6 SLAAC manipulation.

---

## 2. Code Evaluation Criteria

| Dimension | What Strong Looks Like |
| :--- | :--- |
| **Working end-to-end automation** | Priority #1. Code runs fully. No mockups. Handles real download/upload loop. |
| **Error handling** | Priority #2. Handles proxy rotation, HTTP 429/403 codes, and stream/quota failures gracefully. |
| **Scalability** | Code structures memory/disk usage (`tmpfs` partition) and token pool rotation to prevent pipeline degradation. |
| **Flow structure + maintainability** | Clean codebase. Clear naming, logical folder organization, adhere to Google coding standards. |
| **Architectural Separation** | Explicit decoupled API boundary between UI frontend tier and background worker engine. |