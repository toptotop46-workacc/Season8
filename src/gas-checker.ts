import { logger } from './logger.js'

/**
 * Простой мониторинг цены газа в ETH mainnet
 * Использует RPC метод eth_gasPrice для получения текущей цены
 */
export class GasChecker {
  private maxGasPriceGwei: number
  private ethMainnetRpc: string = 'https://ethereum.rpc.thirdweb.com/'

  constructor (maxGasPriceGwei: number) {
    this.maxGasPriceGwei = maxGasPriceGwei
  }

  /**
   * Получить текущую цену газа через eth_gasPrice RPC метод
   */
  async getCurrentGasPrice (): Promise<number> {
    try {
      const response = await fetch(this.ethMainnetRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_gasPrice',
          params: [],
          id: 1
        })
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      if (data.error) {
        throw new Error(`RPC error: ${data.error.message}`)
      }

      const gasPriceWei = BigInt(data.result)
      const gasPriceGwei = Number(gasPriceWei) / 1e9

      return gasPriceGwei
    } catch (error) {
      logger.error('Ошибка получения цены газа', error)
      return 0
    }
  }

  /**
   * Проверить превышение лимита цены газа
   */
  async isGasPriceTooHigh (): Promise<boolean> {
    const currentGas = await this.getCurrentGasPrice()
    return currentGas > this.maxGasPriceGwei
  }

  /**
   * Ожидать снижения цены газа до приемлемого уровня
   */
  async waitForGasPriceToDrop (): Promise<void> {
    while (await this.isGasPriceTooHigh()) {
      const currentGas = await this.getCurrentGasPrice()
      logger.info(`Газ ${currentGas.toFixed(2)} Gwei > ${this.maxGasPriceGwei} Gwei, ждем 1 минуту...`)
      await new Promise(resolve => setTimeout(resolve, 60000)) // 1 минута
    }
    const finalGas = await this.getCurrentGasPrice()
    logger.info(`Газ в норме: ${finalGas.toFixed(2)} Gwei`)
  }

  /**
   * Получить установленный лимит газа
   */
  getMaxGasPrice (): number {
    return this.maxGasPriceGwei
  }
}
