# Infra snippets for mutabaka.com

This folder contains ready-to-copy snippets to integrate mutabaka.com into your existing Watan Nginx container (watan-nginx) setup.

Files:
- nginx/mutabaka.conf — Nginx server blocks for mutabaka.com (HTTP, websocket, www->non-www redirect).

How to use in your infra repo:
1) Copy `infra/nginx/mutabaka.conf` to the same folder where `watan.conf` lives (typically nginx/sites-available/ in the infra repo used by watan-nginx).
2) Create/Update the symlink in nginx/sites-enabled:
   - ln -sf ../sites-available/mutabaka.conf nginx/sites-enabled/mutabaka.conf
3) Commit and push in infra repo, then on the server:
   - git pull origin main
   - docker compose up -d nginx  # or: docker compose restart nginx
4) Verify:
   - docker compose exec nginx nginx -t
   - curl -I http://mutabaka.com/

Note about upstream target:
- The config uses `http://49.13.133.189:8082` (host IP) because requests originate from inside the nginx container. If you have host.docker.internal available, you can replace the IP with `http://host.docker.internal:8082`.

Cloudflare:
- If Cloudflare is set to SSL = Full on mutabaka.com, the origin will need HTTPS (443) soon to avoid 525 errors. After confirming HTTP works, add a 443 server block with Let’s Encrypt or Cloudflare Origin cert.
