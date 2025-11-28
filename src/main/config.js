/** @type {import('../shared/types').ModuleInfo[]} */
const modules = [
  {
    id: 'n8n',
    name: 'n8n',
    description: '工作流自动化与编排引擎',
    category: 'core',
    enabled: true,
    status: 'running',
    port: 5678,
    webUrl: 'http://localhost:5678',
    tags: ['workflow'],
  },
  {
    id: 'dify',
    name: 'Dify',
    description: 'AI 应用与工作流开发平台',
    category: 'feature',
    enabled: true,
    status: 'stopped',
    port: 8081,
    webUrl: null,
    tags: ['app'],
  },
  {
    id: 'oneapi',
    name: 'OneAPI',
    description: '统一 AI API 网关与配额管理',
    category: 'core',
    enabled: true,
    status: 'running',
    port: 3000,
    webUrl: 'http://localhost:3000',
    tags: ['gateway'],
  },
  {
    id: 'ragflow',
    name: 'RagFlow',
    description: 'RAG 知识库问答与文档检索系统',
    category: 'feature',
    enabled: true,
    status: 'error',
    port: 9380,
    webUrl: null,
    tags: ['rag'],
  },
]

/** @type {Record<import('../shared/types').ModuleId, { containerNames: string[] }>}*/
const moduleDockerConfig = {
  n8n: { containerNames: ['ai-server-n8n', 'n8n'] },
  dify: { containerNames: ['ai-server-dify-api', 'ai-server-dify-web', 'ai-server-dify', 'dify'] },
  oneapi: { containerNames: ['ai-server-oneapi', 'oneapi'] },
  ragflow: { containerNames: ['ai-server-ragflow', 'ragflow'] },
}

const moduleImageMap = {
  n8n: 'docker.n8n.io/n8nio/n8n',
  oneapi: 'docker.io/justsong/one-api:latest',
  difyApi: 'docker.io/langgenius/dify-api:1.7.2',
  difyWeb: 'docker.io/langgenius/dify-web:1.7.2',
  ragflow: 'edwardelric233/ragflow:oc9',
}

const MANAGED_NETWORK_NAME = 'ai-server-net'
const N8N_DB_IMAGE = 'postgres:16'
const N8N_DB_CONTAINER_NAME = 'ai-server-postgres'
const N8N_DATA_VOLUME_NAME = 'ai-server-n8n-data'
const N8N_DB_VOLUME_NAME = 'ai-server-postgres-data'
const MYSQL_DB_IMAGE = 'mysql:8.2.0'
const MYSQL_DB_CONTAINER_NAME = 'ai-server-mysql'
const MYSQL_DB_VOLUME_NAME = 'ai-server-mysql-data'
const ONEAPI_DATA_VOLUME_NAME = 'ai-server-oneapi-data'
const DIFY_DATA_VOLUME_NAME = 'ai-server-dify-data'
const REDIS_IMAGE = 'redis:latest'
const REDIS_CONTAINER_NAME = 'ai-server-redis'
const REDIS_DATA_VOLUME_NAME = 'ai-server-redis-data'
const ELASTICSEARCH_IMAGE = 'elasticsearch:8.11.3'
const ELASTICSEARCH_CONTAINER_NAME = 'ai-server-es'
const ELASTICSEARCH_DATA_VOLUME_NAME = 'ai-server-es-data'
const MINIO_IMAGE = 'quay.io/minio/minio:RELEASE.2025-06-13T11-33-47Z'
const MINIO_CONTAINER_NAME = 'ai-server-minio'
const MINIO_DATA_VOLUME_NAME = 'ai-server-minio-data'

export {
  modules,
  moduleDockerConfig,
  moduleImageMap,
  MANAGED_NETWORK_NAME,
  N8N_DB_IMAGE,
  N8N_DB_CONTAINER_NAME,
  N8N_DATA_VOLUME_NAME,
  N8N_DB_VOLUME_NAME,
  MYSQL_DB_IMAGE,
  MYSQL_DB_CONTAINER_NAME,
  MYSQL_DB_VOLUME_NAME,
  ONEAPI_DATA_VOLUME_NAME,
  DIFY_DATA_VOLUME_NAME,
  REDIS_IMAGE,
  REDIS_CONTAINER_NAME,
  REDIS_DATA_VOLUME_NAME,
  ELASTICSEARCH_IMAGE,
  ELASTICSEARCH_CONTAINER_NAME,
  ELASTICSEARCH_DATA_VOLUME_NAME,
  MINIO_IMAGE,
  MINIO_CONTAINER_NAME,
  MINIO_DATA_VOLUME_NAME,
}
