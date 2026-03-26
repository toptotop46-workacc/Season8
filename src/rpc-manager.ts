import { createPublicClient, createWalletClient, http, type Chain, type Account, type PublicClient, type WalletClient } from 'viem'

/**
 * Менеджер RPC с fallback системой для сети Soneium
 */
export class RpcManager {
  private readonly rpcUrls: string[]
  private currentIndex: number = 0

  constructor () {
    // Основной RPC и fallback RPC провайдеры
    this.rpcUrls = [
      'https://soneium-rpc.publicnode.com', // Основной
      'https://1868.rpc.thirdweb.com', // Fallback 1
      'https://soneium.drpc.org', // Fallback 2
      'https://soneium.rpc.hypersync.xyz' // Fallback 3
    ]
  }

  /**
   * Получает текущий RPC URL
   */
  getCurrentRpc (): string {
    return this.rpcUrls[this.currentIndex] || this.rpcUrls[0] || ''
  }

  /**
   * Переключается на следующий RPC при ошибке
   */
  switchToNextRpc (): string | null {
    this.currentIndex++
    if (this.currentIndex >= this.rpcUrls.length) {
      return null // Все RPC исчерпаны
    }
    return this.getCurrentRpc()
  }

  /**
   * Сбрасывает индекс на первый RPC
   */
  reset (): void {
    this.currentIndex = 0
  }

  /**
   * Получает все доступные RPC URL
   */
  getAllRpcUrls (): string[] {
    return [...this.rpcUrls]
  }

  /**
   * Создает public client с текущим RPC
   */
  createPublicClient (chain: Chain): PublicClient {
    return createPublicClient({
      chain,
      transport: http(this.getCurrentRpc(), {
        timeout: 10000,
        retryCount: 3,
        retryDelay: 1000
      })
    })
  }

  /**
   * Создает wallet client с текущим RPC
   */
  createWalletClient (chain: Chain, account: Account): WalletClient {
    return createWalletClient({
      account,
      chain,
      transport: http(this.getCurrentRpc(), {
        timeout: 10000,
        retryCount: 3,
        retryDelay: 1000
      })
    })
  }

  /**
   * Выполняет операцию с автоматическим переключением RPC при ошибках
   */
  async executeWithFallback<T> (
    operation: (rpc: string) => Promise<T>,
    maxRetries: number = this.rpcUrls.length
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const currentRpc = this.getCurrentRpc()
        const result = await operation(currentRpc)

        return result
      } catch (error) {
        lastError = error as Error

        const nextRpc = this.switchToNextRpc()
        if (!nextRpc) {
          break // Все RPC исчерпаны
        }

        // Небольшая задержка перед следующей попыткой
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }

    throw new Error(`Все RPC провайдеры недоступны. Последняя ошибка: ${lastError?.message}`)
  }
}

// Экспортируем singleton instance
export const rpcManager = new RpcManager()

// Экспортируем конфигурацию сети Soneium
export const SONEIUM_CHAIN_ID = 1868

export const soneiumChain: Chain = {
  id: SONEIUM_CHAIN_ID,
  name: 'Soneium',
  nativeCurrency: {
    decimals: 18,
    name: 'Ethereum',
    symbol: 'ETH'
  },
  rpcUrls: {
    default: {
      http: rpcManager.getAllRpcUrls()
    },
    public: {
      http: rpcManager.getAllRpcUrls()
    }
  },
  blockExplorers: {
    default: {
      name: 'Soneium Explorer',
      url: 'https://soneium.blockscout.com'
    }
  }
}
