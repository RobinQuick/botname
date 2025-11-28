# Fly.io Deployment Guide

## Why Fly.io?

**Latency Improvement**: ~250ms faster than Render for Belgium customers
- Render EU-West: ~650ms average E2E latency
- Fly.io Brussels: ~400ms average E2E latency

## Prerequisites

1. **Install Fly CLI**
   ```powershell
   powershell -Command "iwr https://fly.io/install.ps1 -useb | iex"
   ```

2. **Sign up / Login**
   ```bash
   fly auth signup  # or fly auth login
   ```

## Initial Deployment

### 1. Create App
```bash
fly apps create quick-voicebot-drive-thru --org personal
```

### 2. Set Secrets (Environment Variables)
```bash
fly secrets set OPENAI_API_KEY="your-openai-api-key"
fly secrets set NODE_ENV="production"
# Add other secrets as needed
```

### 3. Deploy
```bash
fly deploy
```

This will:
- Build your app
- Deploy to Brussels (bru) region
- Set up health checks
- Configure auto-scaling

### 4. Verify Deployment
```bash
fly status
fly logs
```

## Multi-Region Setup (Optional but Recommended)

For redundancy and even lower latency across Europe:

```bash
# Add Amsterdam as fallback
fly scale count 2 --region bru,ams

# Add Paris for full EU coverage
fly scale count 3 --region bru,ams,cdg
```

**Regions**:
- `bru` - Brussels (primary, closest to Belgium)
- `ams` - Amsterdam (Netherlands fallback)
- `cdg` - Paris (France fallback)

## Monitoring & Scaling

### Check Status
```bash
fly status
fly dashboard  # Opens web dashboard
```

### View Logs
```bash
fly logs          # Recent logs
fly logs -a quick-voicebot-drive-thru  # Specific app
```

### Scale Resources
```bash
# Increase memory if needed
fly scale memory 1024

# Add more instances
fly scale count 2
```

### SSH into Machine
```bash
fly ssh console
```

## Health Checks

The app exposes `/health` endpoint for Fly.io health checks.

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-01-28T10:00:00.000Z",
  "uptime": 3600
}
```

## Custom Domain (Optional)

```bash
fly certs create voicebot.quick.be
# Follow DNS instructions
fly certs check voicebot.quick.be
```

## Cost Estimation

**Free Tier**:
- 3 shared-cpu-1x VMs (256MB RAM each)
- 160GB outbound data transfer
- **Cost**: FREE

**Recommended Setup** (1 VM in Brussels):
- 1x shared-cpu-1x with 512MB RAM
- ~10GB/month transfer (voice bot)
- **Cost**: ~$3-5/month

**Multi-Region** (3 VMs for redundancy):
- 3x shared-cpu-1x with 512MB RAM
- **Cost**: ~$10-15/month

## CI/CD with GitHub Actions

The app includes `.github/workflows/fly-deploy.yml` for auto-deployment.

**Setup**:
1. Get Fly.io API token:
   ```bash
   fly auth token
   ```

2. Add to GitHub Secrets:
   - `FLY_API_TOKEN` = your token

3. Push to main branch → Auto-deploy ✅

## Troubleshooting

### Build Fails
```bash
fly logs
# Check for missing dependencies or build errors
```

### App Won't Start
```bash
fly ssh console
node dist/server.js  # Test manually
```

### High Latency
```bash
# Check closest region to customers
fly platform regions

# Deploy closer
fly scale count 2 --region bru,ams
```

### Out of Memory
```bash
# Increase to 1GB
fly scale memory 1024
```

## Rollback

```bash
# List releases
fly releases

# Rollback to previous
fly releases rollback
```

## Comparison: Render vs Fly.io

| Feature | Render | Fly.io |
|---------|--------|--------|
| **Latency (Belgium)** | 650ms avg | 400ms avg |
| **Regions** | Fixed (US/EU) | 30+ worldwide |
| **Edge Routing** | No | Yes (Anycast) |
| **Cold Starts** | 50-100ms | 10-30ms |
| **Free Tier** | Limited | 3 VMs + 160GB |
| **Cost (1 VM)**| $7/month | $3-5/month |
| **WebSockets** | Good | Excellent |
| **Setup** | Easier | Moderate |

## Next Steps

1. ✅ Deploy to Fly.io Brussels
2. ✅ Test latency with real customers
3. ✅ Add Amsterdam/Paris regions if needed
4. ✅ Set up monitoring dashboard
5. ✅ Configure auto-deploy via GitHub Actions

**For production**: Start with 1 VM in Brussels, scale to 2-3 VMs across regions after testing.
