# CerberusAgent — Cockpit Web (React)
# Placeholder — Jalon 6

FROM node:20-alpine
WORKDIR /app

# Placeholder: serve a simple health page
RUN echo '{"status":"placeholder","service":"cerberus-cockpit","note":"Jalon 6 — not yet implemented"}' > /app/health.json

RUN npm init -y && npm install serve

EXPOSE 5173

CMD ["npx", "serve", "-l", "5173", "/app"]
