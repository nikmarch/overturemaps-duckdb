#!/bin/bash
# Start local development servers

echo "Starting worker on http://localhost:8787..."
cd worker && npx wrangler dev --port 8787 &
WORKER_PID=$!

echo "Starting frontend on http://localhost:8080..."
cd ../src && python3 -m http.server 8080 &
FRONTEND_PID=$!

echo ""
echo "Development servers running:"
echo "  - Worker:   http://localhost:8787"
echo "  - Frontend: http://localhost:8080"
echo ""
echo "Press Ctrl+C to stop..."

trap "kill $WORKER_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
