export interface WebGPUCapabilities {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxUniformBufferBindingSize: number;
  maxBindGroups: number;
  maxBindingsPerBindGroup: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupSizeY: number;
  maxComputeWorkgroupSizeZ: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupsPerDimension: number;
  supportsTimestampQuery: boolean;
  supportsSubgroups: boolean;
  supportsTextureCompressionBC: boolean;
  supportsTextureCompressionASTC: boolean;
  supportsTextureCompressionETC2: boolean;
  limits: GPUSupportedLimits;
  features: GPUSupportedFeatures;
}

export interface WebGPUDeviceConfig {
  powerPreference?: 'high-performance' | 'low-power';
  forceFallbackAdapter: boolean;
  requiredFeatures: GPUFeatureName[];
  requiredLimits: Record<string, number>;
  alphaMode: GPUCanvasAlphaMode;
}

export const DEFAULT_WEBGPU_CONFIG: WebGPUDeviceConfig = {
  powerPreference: undefined,
  forceFallbackAdapter: false,
  // Ask only for features that are actually useful for this renderer. Every
  // requested feature is filtered against the adapter before requestDevice.
  requiredFeatures: ['depth-clip-control'],
  requiredLimits: {
    maxStorageBufferBindingSize: 128 * 1024 * 1024,
    maxUniformBufferBindingSize: 64 * 1024,
    maxBindGroups: 4,
    maxBindingsPerBindGroup: 1000,
    maxComputeWorkgroupSizeX: 256,
    maxComputeWorkgroupSizeY: 256,
    maxComputeWorkgroupSizeZ: 64,
    maxComputeInvocationsPerWorkgroup: 256,
    maxComputeWorkgroupsPerDimension: 65535,
  },
  alphaMode: 'premultiplied',
};

export class WebGPUDevice {
  private adapter: GPUAdapter | null = null;
  private device: GPUDevice | null = null;
  private context: GPUCanvasContext | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly config: WebGPUDeviceConfig;
  private capabilities: WebGPUCapabilities | null = null;
  private onDeviceLost: ((reason: string) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, config: Partial<WebGPUDeviceConfig> = {}) {
    this.canvas = canvas;
    this.config = { ...DEFAULT_WEBGPU_CONFIG, ...config };
  }

  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.warn('WebGPU not supported in this browser');
      return false;
    }

    try {
      const adapterOptions: GPURequestAdapterOptions = {
        forceFallbackAdapter: this.config.forceFallbackAdapter,
      };
      if (this.config.powerPreference) {
        adapterOptions.powerPreference = this.config.powerPreference;
      }
      this.adapter = await navigator.gpu.requestAdapter(adapterOptions);

      if (!this.adapter) {
        console.warn('No suitable WebGPU adapter found');
        return false;
      }

      const adapterFeatures = this.adapter.features;
      const requiredFeatures = this.config.requiredFeatures.filter((feature) =>
        adapterFeatures.has(feature),
      );

      const adapterLimits = this.adapter.limits as unknown as Record<string, number>;
      const requiredLimits: Record<string, number> = {};
      for (const [key, value] of Object.entries(this.config.requiredLimits)) {
        const available = adapterLimits[key];
        if (typeof available === 'number' && value <= available) {
          requiredLimits[key] = value;
        }
      }

      try {
        this.device = await this.adapter.requestDevice({
          requiredFeatures,
          requiredLimits,
        });
      } catch {
        // Some adapters reject a partial limits object. Retry with defaults.
        this.device = await this.adapter.requestDevice({
          requiredFeatures: [],
          requiredLimits: {},
        });
      }

      this.device.lost.then((info) => {
        console.error('WebGPU device lost:', info.reason, info.message);
        this.handleDeviceLost(info.reason);
      });

      this.capabilities = this.extractCapabilities();
      this.setupCanvasContext();

      const info = (this.adapter as unknown as { info?: { description?: string } }).info;
      console.log('WebGPU device initialized:', info?.description ?? 'unknown adapter');
      return true;
    } catch (error) {
      console.error('Failed to initialize WebGPU:', error);
      this.destroy();
      return false;
    }
  }

  private extractCapabilities(): WebGPUCapabilities {
    if (!this.device) {
      throw new Error('WebGPU device is not initialized');
    }

    const limits = this.device.limits;
    const features = this.device.features;

    return {
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxUniformBufferBindingSize: limits.maxUniformBufferBindingSize,
      maxBindGroups: limits.maxBindGroups,
      maxBindingsPerBindGroup: limits.maxBindingsPerBindGroup,
      maxComputeWorkgroupSizeX: limits.maxComputeWorkgroupSizeX,
      maxComputeWorkgroupSizeY: limits.maxComputeWorkgroupSizeY,
      maxComputeWorkgroupSizeZ: limits.maxComputeWorkgroupSizeZ,
      maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
      supportsTimestampQuery: features.has('timestamp-query'),
      supportsSubgroups: features.has('subgroups'),
      supportsTextureCompressionBC: features.has('texture-compression-bc'),
      supportsTextureCompressionASTC: features.has('texture-compression-astc'),
      supportsTextureCompressionETC2: features.has('texture-compression-etc2'),
      limits,
      features,
    };
  }

  private setupCanvasContext(): void {
    if (!this.device) {
      throw new Error('WebGPU device is not initialized');
    }

    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      throw new Error('Failed to get WebGPU canvas context');
    }

    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: presentationFormat,
      alphaMode: this.config.alphaMode,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
  }

  private handleDeviceLost(reason: string): void {
    this.onDeviceLost?.(reason);
  }

  setDeviceLostCallback(callback: (reason: string) => void): void {
    this.onDeviceLost = callback;
  }

  getDevice(): GPUDevice | null {
    return this.device;
  }

  getAdapter(): GPUAdapter | null {
    return this.adapter;
  }

  getContext(): GPUCanvasContext | null {
    return this.context;
  }

  getCapabilities(): WebGPUCapabilities | null {
    return this.capabilities;
  }

  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  getPresentationFormat(): GPUTextureFormat {
    return navigator.gpu.getPreferredCanvasFormat();
  }

  destroy(): void {
    this.device?.destroy();
    this.device = null;
    this.adapter = null;
    this.context = null;
    this.capabilities = null;
  }
}

export function isWebGPUSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function getWebGPUInfo(): { supported: boolean; reason?: string } {
  if (!isWebGPUSupported()) {
    return { supported: false, reason: 'WebGPU API not available in navigator' };
  }
  return { supported: true };
}
