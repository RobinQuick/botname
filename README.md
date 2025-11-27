# Smart Drive Voicebot (V1)

A production-grade AI voicebot for Quick drive-thru, powered by OpenAI Realtime API.

## Prerequisites

- **Node.js**: Version 22 or higher (LTS recommended). [Download here](https://nodejs.org/).
- **OpenAI API Key**: Required for the voicebot to function.

## Installation

1.  Clone the repository.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Configure environment variables:
    - Create a `.env` file in the root directory (copy from `.env.example` if available, or use the provided configuration).
    - Ensure `OPENAI_API_KEY` is set.

## Running the Application

To start both the backend server and the frontend client concurrently:

```bash
npm run dev
```

- **Backend**: Runs on `http://localhost:3000`
- **Frontend**: Runs on `http://localhost:5173`

## Usage

### Standard Mode
**URL**: [http://localhost:5173/](http://localhost:5173/)

This is the full production mode.
- **Voicebot**: Active.
- **POS Integration**: Active (Orders are sent to the POS API).

### Test Mode
**URL**: [http://localhost:5173/test](http://localhost:5173/test)

Use this mode for testing the chatbot quality without affecting the POS system.
- **Voicebot**: Active.
- **POS Integration**: **Disabled** (Orders are simulated/mocked).
- **Visual Indicator**: Shows a "TEST MODE" badge.
