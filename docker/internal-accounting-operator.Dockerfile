# Internal offline operator companion only. Supply a digest-pinned Node 24 base.
# No changes to the default application Dockerfile or runtime admission.
ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS deps
WORKDIR /opt/sqljs
COPY package.json /tmp/9router-package.json
RUN npm install --no-audit --no-fund --ignore-scripts --no-save \
    "sql.js@$(node -p 'require("/tmp/9router-package.json").dependencies["sql.js"]')"

FROM ${NODE_IMAGE}
LABEL io.9router.internal-purpose="accounting-operator"
WORKDIR /opt/9router-operator
COPY package.json ./
COPY --from=deps /opt/sqljs/node_modules/sql.js ./node_modules/sql.js
COPY scripts/provision-internal-accounting.mjs ./scripts/
COPY src/lib/dataDir.js ./src/lib/
COPY src/lib/db/ ./src/lib/db/
COPY src/lib/accounting/ ./src/lib/accounting/
COPY src/lib/pricing/ ./src/lib/pricing/
COPY src/shared/utils/keyAccess.js ./src/shared/utils/
COPY src/shared/constants/keyAccess.js ./src/shared/constants/
COPY open-sse/services/accountFallback.js ./open-sse/services/
COPY open-sse/config/errorConfig.js ./open-sse/config/
COPY open-sse/utils/ordinary-dispatch.js ./open-sse/utils/
# Keep code root-owned and readable by node even from a private build context.
RUN --network=none find . -type d -exec chmod 0755 '{}' + \
    && find . -type f -exec chmod 0644 '{}' +
USER node
ENTRYPOINT ["node", "/opt/9router-operator/scripts/provision-internal-accounting.mjs"]
