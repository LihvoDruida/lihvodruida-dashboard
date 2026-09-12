export type CpuCoreMetric = {
  index: number;
  model: string;
  speedMHz: number;
  usagePercent: number | null;
};


export type DockerStorageMetric = {
  type: string;
  totalCount: number | null;
  activeCount: number | null;
  sizeBytes: number | null;
  reclaimableBytes: number | null;
  reclaimablePercent: number | null;
};

export type DockerStorageSnapshot = {
  sampledAt: string | null;
  available: boolean;
  metrics: DockerStorageMetric[];
  buildCache: DockerStorageMetric | null;
  images: DockerStorageMetric | null;
  containers: DockerStorageMetric | null;
  volumes: DockerStorageMetric | null;
};

export type ServerStatusSnapshot = {
  sampledAt: string;
  platform: {
    hostname: string;
    platform: string;
    release: string;
    arch: string;
    nodeVersion: string;
  };
  uptime: {
    systemSeconds: number;
    processSeconds: number;
  };
  cpu: {
    model: string;
    logicalCores: number;
    usagePercent: number | null;
    loadAverage: [number, number, number];
    cores: CpuCoreMetric[];
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercent: number;
    swapTotalBytes: number | null;
    swapUsedBytes: number | null;
    swapFreeBytes: number | null;
    processRssBytes: number;
    processHeapUsedBytes: number;
    processHeapTotalBytes: number;
  };
  disk: {
    path: string;
    totalBytes: number | null;
    usedBytes: number | null;
    freeBytes: number | null;
    usagePercent: number | null;
  };
  docker: DockerStorageSnapshot | null;
};
