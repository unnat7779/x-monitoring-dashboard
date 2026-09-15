# 🐦 Real-Time X (Twitter) Monitoring Dashboard

A production-ready, full-stack real-time Twitter/X monitoring dashboard built with **Next.js (App Router)**, **Tailwind CSS**, **SWR Polling**, and **AWS S3 Storage**, optimized for seamless deployment on **Vercel**.

Monitors live tweets from 3 specific accounts:
- **@YatinMota** (Yatin Mota)
- **@ANI** (ANI News)
- **@SoumeetSarkar** (Soumeet Sarkar)

---

## 🏗️ Architecture

```mermaid
flowchart TD
    A[Twitter / X Stream] -->|Matches Filter Rule| B[TwitterAPI.io]
    B -->|POST Webhook with x-api-key| C[Next.js API: /api/twitter-webhook]
    C -->|Authenticate & Parse| D[Store in AWS S3 Bucket / S3 Sync]
    E[Frontend Dashboard] -->|SWR Auto-Polling every 5s| F[Next.js API: /api/tweets]
    F -->|Reads latest tweets| D
    E -->|Renders Feed & Live Metrics| G[User Interface with Glassmorphism UI]
```

---

## 📦 Features

- ⚡ **Real-Time Webhook Consumer (`/api/twitter-webhook`)**: Fast ingestion with `x-api-key` validation, tweet normalization, and immediate HTTP 200 acknowledgment.
- 🗄️ **Persistent Cloud Storage (AWS S3)**: Automatically syncs incoming tweets to an S3 bucket (`tweets.json`) with an in-memory cache to minimize read latency and AWS costs.
- 🔄 **Live Feed Layer (SWR)**: Polls every 5 seconds without manual page refreshes, with smooth slide-in animations when new tweets arrive.
- 🧩 **Chrome Extension (Manifest V3 Side Panel)**: Native Chrome side panel extension to monitor real-time breaking market news directly alongside `x.com` / Twitter.
- 📱 **Compact Side Panel Route (`/sidepanel`)**: Ultra-streamlined companion view optimized for narrow sidebars (320px–400px) showing the top 3–5 breaking updates.
- 🎨 **Sleek Dark Theme UI**: Built with modern typography, glassmorphism cards, animated LIVE status badge, author avatars, media rendering, and metric counters.
- 🔍 **Search & Account Filtering**: Filter by specific accounts or search keywords and handles in real-time.
- ☁️ **Vercel Serverless Ready**: Stateless architecture designed to work cleanly within Vercel's serverless runtime.

---

## 🧩 Chrome Extension Installation Guide

You can run the X Monitor side panel directly in Chrome alongside your active `x.com` / Twitter tab:

1. Open Google Chrome and go to `chrome://extensions/`
2. Toggle on **"Developer mode"** (top-right corner).
3. Click **"Load unpacked"** (top-left corner).
4. Select the `extension/` folder inside this repository.
5. While browsing `x.com` or any website, click the **X Monitor extension icon** in your Chrome toolbar to slide open the real-time breaking news side panel!

---

## 🛠️ Step-by-Step AWS S3 Setup Guide

To enable persistent cloud storage for tweets across serverless deployments, set up an AWS S3 bucket and IAM user.

### Step 1: Create an S3 Bucket
1. Log in to the [AWS Management Console](https://console.aws.amazon.com/s3/).
2. Navigate to **S3** $\rightarrow$ Click **Create bucket**.
3. **Bucket Name**: Enter a globally unique name (e.g., `x-monitoring-tweets-yourname`).
4. **AWS Region**: Select your preferred region (e.g., `us-east-1` or `ap-south-1`).
5. **Object Ownership**: Leave as *ACLs disabled (recommended)*.
6. **Block Public Access**: Keep **"Block *all* public access" checked** (our Next.js backend will access S3 securely using IAM credentials).
7. **Bucket Versioning**: Optional (can leave Disabled).
8. Click **Create bucket**.

---

### Step 2: Create IAM User & Get Access Keys
1. Navigate to **IAM** in AWS Console $\rightarrow$ Click **Users** $\rightarrow$ **Create user**.
2. **User name**: `x-monitoring-s3-user`.
3. Do *not* select AWS Management Console access (programmatic access only). Click **Next**.
4. On the **Set permissions** page, select **Attach policies directly** $\rightarrow$ Click **Create policy** (opens in a new tab).
5. In the Policy editor, switch to **JSON** and paste the following least-privilege policy (replace `YOUR_BUCKET_NAME` with your actual bucket name):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME",
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ]
    }
  ]
}
```
6. Name the policy `XMonitoringS3Policy` and click **Create policy**.
7. Return to the IAM User creation tab, refresh the policies list, select `XMonitoringS3Policy`, and click **Next** $\rightarrow$ **Create user**.
8. Click on your newly created user (`x-monitoring-s3-user`) $\rightarrow$ Go to the **Security credentials** tab.
9. Under **Access keys**, click **Create access key** $\rightarrow$ Select **Application running outside AWS** $\rightarrow$ Click **Next** $\rightarrow$ **Create access key**.
10. Copy and securely save:
    - **`Access key ID`** (e.g., `AKIA...`)
    - **`Secret access key`** (e.g., `wJalrXUtnFEMI/K7MDENG/bPxRfiCY...`)

---

## 🔑 Required Environment Variables

Add these to `.env.local` (for local development) and in your **Vercel Project Settings** $\rightarrow$ **Environment Variables**:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `TWITTERAPI_IO_KEY` | TwitterAPI.io API key for webhook validation | `your_twitterapi_io_key_here` |
| `AWS_REGION` | AWS region where your S3 bucket resides | `us-east-1` |
| `AWS_ACCESS_KEY_ID` | IAM User Access Key ID | `AKIAIOSFODNN7EXAMPLE` |
| `AWS_SECRET_ACCESS_KEY` | IAM User Secret Access Key | `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` |
| `AWS_S3_BUCKET_NAME` | Name of your S3 bucket | `x-monitoring-tweets-prod` |
| `AWS_S3_KEY` | *(Optional)* File name on S3 | `tweets.json` (default) |

---

## 📡 TwitterAPI.io Webhook Configuration

1. Log in to [TwitterAPI.io](https://twitterapi.io).
2. Go to **Dashboard** $\rightarrow$ **Stream / Filter Rules**.
3. Confirm your rule is active:
   ```text
   from:YatinMota OR from:ANI OR from:SoumeetSarkar
   ```
4. Go to **Webhook Settings** and configure:
   - **Webhook URL**: `https://your-app.vercel.app/api/twitter-webhook`
   - **Headers**:
     - `x-api-key`: `your_twitterapi_io_key_here`
5. Save and enable the webhook.

---

## 🚀 Local Development

```bash
# 1. Clone or navigate to the directory
cd /Users/unnatagrawal/Developer/X_monitoring

# 2. Install dependencies
npm install

# 3. Configure environment variables in .env.local
cp .env.example .env.local
# Edit .env.local with your keys

# 4. Start local development server
npm run dev

# App runs on http://localhost:3000
```

---

## 🧪 Testing the Webhook Locally

You can simulate an incoming tweet payload from TwitterAPI.io using `curl`:

```bash
curl -X POST http://localhost:3000/api/twitter-webhook \
  -H "Content-Type: application/json" \
  -H "x-api-key: your_twitterapi_io_key_here" \
  -d '{
    "event_type": "tweet",
    "rule_id": "da7cc25ef0b1473491ae8d43491643a0",
    "rule_tag": "TARGET-ACCOUNTS-MONITOR",
    "tweets": [
      {
        "id": "1892000000000000001",
        "text": "Market Update: Nifty breaks records with massive institutional volume. #Markets",
        "created_at": "2026-08-20T17:15:00.000Z",
        "user": {
          "id": "1001",
          "name": "Yatin Mota",
          "username": "YatinMota",
          "profile_image_url": ""
        },
        "public_metrics": {
          "like_count": 142,
          "retweet_count": 38,
          "reply_count": 12
        }
      }
    ]
  }'
```

---

## 🚢 Deploying to Vercel

### Option A: Using Vercel CLI
```bash
npm install -g vercel
vercel
```

### Option B: Using GitHub / Vercel Dashboard
1. Push this repository to GitHub.
2. Import the repo into [Vercel](https://vercel.com/new).
3. In the **Environment Variables** section, add:
   - `TWITTERAPI_IO_KEY`
   - `AWS_REGION`
   - `AWS_ACCESS_KEY_ID`
   - `AWS_SECRET_ACCESS_KEY`
   - `AWS_S3_BUCKET_NAME`
4. Click **Deploy**.

Once deployed, copy your deployment URL (e.g. `https://x-monitoring.vercel.app`) and set `https://x-monitoring.vercel.app/api/twitter-webhook` as your webhook endpoint on TwitterAPI.io.
