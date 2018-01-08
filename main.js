const SimpleTelegram = require('./simple-telegram')
const Bittrex = require('./bittrex')
const chalk = require('chalk')
const config = require('config')
const stg = new SimpleTelegram()

/**
 * Configuration load and check
 */
const trexCfg = config.get('Exchange').bittrex
const tradesCfg = config.get('Trading')
assertSettings(trexCfg, tradesCfg);

/**
 * Settings to correctly recognize the signal and find the currency+price
 */
const signalsRegexpCfg = config.get('Signals').regexp
const signalGroupRegexp = new RegExp(signalsRegexpCfg.group)
const signalKeywordRegexp = new RegExp(signalsRegexpCfg.keyword)
const signalCoinRegexp = new RegExp(signalsRegexpCfg.coin)
const signalPriceRegexp = new RegExp(signalsRegexpCfg.price)
const skipKeywordRegexp = new RegExp(signalsRegexpCfg.skipKeyword, "i")

// Creating simpleTelegram object
const tgCfg = config.get('Telegram')
stg.create(tgCfg.binFile, tgCfg.keysFile)
stg.setTelegramDebugFile("telegram.log")
stg.getProcess().stdout.on("receivedMessage", function(msg) {
    if (isSignal(msg)) {
        console.log(chalk.inverse("=============================="))
        console.log(chalk.blue.bold("Received signal! Processing..."))
        console.log(new Date() + " " + msg.caller + ": " + msg.content)
        if (skipSignal(msg.content)) {
            console.log(chalk.blue("Regexp matched a skip keyword. Skipping this signal."))
            return
        }
        processSignal(msg.content)
    }
})

/**
 * Extracting currency (BTC-XXX) and price and placing an order
 * @param s
 */
function processSignal(s) {
    const currency = s.match(signalCoinRegexp)[0]
    var price = s.match(signalPriceRegexp)[0]
    if (price.charAt(0) === ".") {
        price = 0 + price
    }
    if (currency && price) {
        new Bittrex(trexCfg, tradesCfg)
            .checkBalancesAndBuy(currency, parseFloat(price))
    } else {
        console.log(chalk.red("Could not find currency or price. Skipping this signal."))
    }
}

/**
 * Checks if the message matches the skipKeywordRegexp or not
 * @param s
 * @returns {boolean}
 */
function skipSignal(s) {
    return !!s.match(skipKeywordRegexp)
}

/**
 * Checks if the message is a signal or not
 * @param msg
 * @returns {boolean}
 */
function isSignal(msg) {
    return !!(msg.caller.match(signalGroupRegexp) && msg.content.match(signalKeywordRegexp));
}

/**
 * Checks if the settings are correct.
 */
function assertSettings(trexCfg, tradesCfg) {
    if (trexCfg.apiKey.length <= 0 || trexCfg.apiSecret.length <= 0) {
        throw new Error("Please fill in the Bittrex API keys. Terminating...")
    }
    if (tradesCfg.btcAmount > 0.5) {
        console.log(chalk.yellow("WARNING: You are using a lot of money for altcoin trading. Supervising the bot is recommended."))
    }
    if (tradesCfg.highestMarkup > 1.1) {
        throw new Error("The markup is too high! Please set it to a lower value and try again. Terminating...")
    }
    if (Object.keys(tradesCfg.takeProfit).length > 0) {
        var sum = 0
        Object.keys(tradesCfg.takeProfit).forEach(function(k) {
            if (tradesCfg.takeProfit.hasOwnProperty(k)) {
                sum += tradesCfg.takeProfit[k];
            } else {
                throw new Error("The take-profit object has some values missing. Terminating...")
            }
            if (k > 50) {
                console.log(chalk.yellow("WARNING: Your take-profit steps are set to over 50%."))
            }
        })
        if (sum!=100) {
            throw new Error("The take-profit percentages must be set to give 100% together. Terminating...")
        }
    } else {
        console.log(chalk.yellow("WARNING: The take-profit object is empty. Consider using it to automate the trading process."))
    }
    if (tradesCfg.closeTimeLimit < 10 || tradesCfg.closeTimeLimit > 900) {
        throw new Error("The close time limit must be between 10 and 900 seconds.")
    }
    console.log("Settings checked!")
}
