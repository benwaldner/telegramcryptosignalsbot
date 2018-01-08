class bittrex {

    constructor(trexCfg, tradesCfg) {
        this.chalk = require('chalk');
        this.bittrex  = require('node-bittrex-api');
        this.bittrex.options({
            'apikey' : trexCfg.apiKey,
            'apisecret' : trexCfg.apiSecret
        });
        this.btcAmount = tradesCfg.btcAmount;
        this.highestMarkup = tradesCfg.highestMarkup;
        this.takeProfit = tradesCfg.takeProfit;
        this.maxTries = tradesCfg.closeTimeLimit/10;
        this.triesCounter = 0;
    }

    /**
     * Check balance of BTC, if available and the price is within the markup bound, place the buy order
     * @param currency
     * @param price
     */
    checkBalancesAndBuy(currency, price) {
        console.log("Signal parsed successfully, confirming...");
        const that = this;
        this.bittrex.getbalance({ currency : 'BTC' }, function( data, err ) {
            if (err) {
                console.log(that.chalk.red("Balance retrieval error: " + err.message));
            }
            if (data) {
                if (data.result.Balance >= that.btcAmount) {
                    const currencyPair = `BTC-${currency}`;
                    that.bittrex.getorderbook({ market : currencyPair, type : "both"}, function( data, err ) {
                        if (err) {
                            console.log(that.chalk.red("Order book error: " + err.message))
                        }
                        if (data) {
                            const lowestAsk = data.result.sell[0].Rate;
                            const highestBid = data.result.buy[0].Rate;
                            const maxPrice = price*that.highestMarkup;
                            if (maxPrice > lowestAsk) {
                                // if lowestAsk is 5% lower than the signalled one, the order will not be placed
                                if (bittrex.percentageChange(lowestAsk, price) < -5) {
                                    console.log(that.chalk.yellow("The coin price differs too much from the signalled price! Possibly mistaken signal. Skipping.",
                                        `Signalled price: ${price}, Current lowest ask: ${lowestAsk}, highest bid: ${highestBid}`));
                                    return
                                }
                                that.buy(lowestAsk, currencyPair, currency);
                            } else {
                                console.log(that.chalk.yellow("Asks are too high to buy for this price! Skipping this signal.",
                                    `Signalled price: ${price}, max price: ${maxPrice}. Current lowest ask: ${lowestAsk}, highest bid: ${highestBid}`));
                            }
                        }
                    });
                } else {
                    console.log(that.chalk.red(`Not enough funds. Cannot buy any ${currency}. Skipping this signal...`))
                }
            }
        });
    }

    /**
     * For blind check if the signalled coin price is not mistaken
     * Returns price difference in %
     * @param lowestAsk
     * @param price
     * @returns {number}
     */
    static percentageChange(lowestAsk, price) {
        return (lowestAsk - price)/price*100;
    }

    /**
     * Placing the buy order
     * @param buyPrice
     * @param currencyPair
     * @param currency
     */
    buy(buyPrice, currencyPair, currency) {
        const that = this;
        const amount = this.btcAmount / buyPrice;
        console.log(this.chalk.bgCyan(`===== PLACING LIMIT BUY ORDER (${currencyPair}) =====`));
        this.bittrex.buylimit({market : currencyPair, quantity : amount, rate : buyPrice}, function ( data, err ) {
            if (err) {
                console.log(that.chalk.red("Order LIMIT BUY error: " + err.message));
            }
            if (data) {
                console.log(that.chalk.green(new Date() + ` Placed order for ${amount} of ${currency} | Rate: ${buyPrice} | Total BTC: ${amount*buyPrice} BTC |ID: ${data.result.uuid}`));
                that.waitForClosing(data.result.uuid, buyPrice, currencyPair, currency);
            }
        });
    }

    /**
     * Waiting until order is closed and sets the take-profits orders if so
     * If it is not closed within given time, the order gets closed manually
     * @param uuid
     * @param buyPrice
     * @param currencyPair
     * @param currency
     */
    waitForClosing(uuid, buyPrice, currencyPair, currency) {
        const that = this;
        this.bittrex.getorder({ uuid : uuid }, function (data, err) {
            if (err) {
                console.log(that.chalk.red("Order status error: " + err.message));
            }
            if (data) {
                if (data.result.IsOpen === true && that.triesCounter < that.maxTries) {
                    setTimeout(function() {
                        that.triesCounter++;
                        that.waitForClosing(uuid, buyPrice, currencyPair, currency);
                    }, 10000);
                } else if (data.result.IsOpen === true && that.triesCounter >= that.maxTries) {
                    console.log(new Date() + ` Order not filled within ${that.closeTimeLimit}. Closing...`)
                    that.closeOrder(data.result)
                } else if (data.result.IsOpen === false) {
                    if (Object.keys(that.takeProfit).length > 0) {
                        that.checkBalanceAndSell(buyPrice, currencyPair, currency);
                    } else {
                        console.log(that.chalk.green("Take profit settings empty, nothing to do, waiting for another signal..."))
                    }
                } else {
                    throw new Error("Unexpected state of order. Terminating...");
                }
            }
        })
    }

    /**
     * @param order
     */
    closeOrder(order) {
        const that = this;
        console.log(`Closing order ${order.uuid}`)
        this.bittrex.cancel({ uuid: order.uuid }, function( data, err ) {
            if (err) {
                console.log(that.chalk.red("Close order error: " + err.message));
            }
            if (data && data.success === true) {
                console.log(that.chalk.green(`Closed order ID ${order.OrderUuid}: ${order.Type} ${order.Exchange}`));
            }
        })
    }

    /**
     * Checks balance and places take-profit orders.
     * @param buyPrice
     * @param currencyPair
     * @param currency
     */
    checkBalanceAndSell(buyPrice, currencyPair, currency) {
        const that = this;
        this.bittrex.getbalance({ currency : currency }, function( data, err ) {
            if (err) {
                console.log(that.chalk.red("Balance retrieval error: " + err.message));
            }
            if (data) {
                const totalSellAmount = data.result.Balance;
                console.log(that.chalk.bgCyan(`===== PLACING TAKE-PROFIT ORDERS (${currencyPair}) =====`));
                const keys = Object.keys(that.takeProfit)
                const last = keys[keys.length-1]
                keys.forEach(function(k) {
                    let amountMultiplier = parseFloat(that.takeProfit[k]) / 100;
                    let priceMultiplier = 1 + parseFloat(k)/100;
                    if (that.takeProfit.hasOwnProperty(k)) {
                        if (k===last) {
                            that.sellAll(currency, currencyPair, buyPrice * priceMultiplier);
                        } else {
                            that.sell(currency, currencyPair, totalSellAmount * amountMultiplier, buyPrice * priceMultiplier);
                        }
                    }
                })
            }
        });
    }

    /**
     * Sell given amount of given coins for given price
     * @param currency
     * @param currencyPair
     * @param sellAmount
     * @param sellPrice
     */
    sell(currency, currencyPair, sellAmount, sellPrice) {
        const that = this;
        this.bittrex.selllimit({market : currencyPair, quantity : sellAmount, rate : sellPrice}, function ( data, err ) {
            if (err) {
                console.log(that.chalk.red("Order LIMIT SELL error: " + err.message));
            }
            if (data) {
                console.log(that.chalk.green(new Date() + ` Placed order to sell ${sellAmount} of ${currency} | Rate: ${sellPrice} | Total BTC: ${sellAmount*sellPrice} BTC | ID: ${data.result.uuid}`));
            }
        });
    }

    /**
     * Sell all of the current balance
     * @param currency
     * @param currencyPair
     * @param sellPrice
     */
    sellAll(currency, currencyPair, sellPrice) {
        const that = this;
        this.bittrex.getbalance({ currency : currency }, function( data, err ) {
            if (err) {
                console.log(that.chalk.red("Balance retrieval error: " + err.message));
            }
            if (data) {
                const totalSellAmount = data.result.Available;
                that.sell(currency, currencyPair, totalSellAmount, sellPrice)
            }
        });
    }
}

module.exports = bittrex;
