require('dotenv').config();
const {CronJob} = require('cron');
const Discord = require('discord.js');
const egsCrawler = require('epic-games-store-crawler');
const sqlite3 = require('sqlite3').verbose();

var crawler = egsCrawler.Crawler;
const bot = new Discord.Client();

const token = process.env.TOKEN;
//const dir = process.env.PATH_DIR;
//const path = dir + process.env.PATH_FILE;

const url = process.env.GAME_URL;
const urlExt = process.env.PART_URL;

const prefix = process.env.PREFIX;

var countryLocale = "en-US";

const game = {

    title: "",
    imgURL: "",
    webURL: "",
    expiryDate: null,

}

const cache = {};

// Function for use when guild is created or bot is invited to the guild.
// When bot is invited to server (guild), this function specifially checks to see if
// there is a general chat so that it can save it as the default channel and then
// send the free game offer to that channel.
bot.on('guildCreate', async (guild) => {
    const channel = guild.channels.cache.find ( ch => ch.name === "general" && ch.type === 'text');
    if (!channel){
        const fetchlogs = await guild.fetchAuditLogs({ 
            type: 'BOT_ADD'
        });
        console.log("checking logs");
        const botLog = fetchlogs.entries.find (logs => logs.target.id === bot.user.id);
        console.log("Target Acquired! in " + guild.name);
        botLog.executor.send("Could not find general channel in " + guild.name + ".\nPlease update the channel on your server using the `LL!setChannel` command in the channel you want to use");
    } else {
        saveToDB(guild, channel);
        channel.send(await createEmbed());
    }
});

//
bot.on('channelUpdate', async (newChannel) => {
    saveToDB(newChannel.guild, newChannel);
    newChannel.send("Updated default channel");
});

bot.on('guildDelete', async (guild) => {
    // remove guild info from db
    var db = new sqlite3.Database('./.data/ludumliberum.db');
    db.serialize(function () {
        db.run(`DELETE FROM guilds WHERE guild_id = ?`, guild.id, (err) => {
            if (err) console.log(err);
            console.log(`Deleted ${guild.name} (${this.changes} row) from the database.`);
            db.close((err) => {
                if (err) {
                return console.error(err.message);
                }
            });
        });
    });
});

bot.on('ready', async () => {
    bot.user.setActivity(`LL!help`);
    // Cron scheduled job at 6am every friday "0 6 * * FRI"
    var job = new CronJob('0 6 * * FRI', function () {
        perServerSend();
    }, null, true, 'Pacific/Auckland');
    job.start();
});

bot.on("message", async function(msg) {

    if(!msg.guild) return;
    if(msg.author.bot) return;
    if(!msg.content.startsWith(prefix)) return;

    const commandBody = msg.content.slice(prefix.length);
    const args = commandBody.split(" ");
    const command = args.shift().toLowerCase();

    switch(command) {
        case "setChannel":
        case "sc":
            setChannel(msg);
            break;
        case "help":
            msg.channel.send("`LL!setChannel` or `LL!sc` to set the channel for the bot messages (ADMIN ONLY)");
            break;
    }
});

// NEED TO FIX: - add a command to change country and locale per server setting ~
//              - add a command to change channel if general isnt available ✓
//              - add help command for admin ~
//              - add translate function depending on country

async function getGameData(){
    try{
        var country = countryLocale.split('-').pop();
        var lang = countryLocale.split('-').shift();
        const response = await crawler.getFreeGames({
            allowCountries: country,
            country: country,
            locale: countryLocale
        });
        setGameData(response);
    } catch (err){
        console.log(err)
    }
}

function setGameData (res){
    var games = res.Catalog.searchStore.elements;
    // Find specific game
    for (var i in games){
        if (games[i].promotions !== null && games[i].price.totalPrice.discountPrice === 0) {
            // Arrange game info
            console.log(games[i]);
            game.title = games[i].title;
            game.expiryDate = games[i].promotions.promotionalOffers[0].promotionalOffers[0].endDate;
            game.webURL = url + countryLocale + urlExt + games[i].productSlug;
            for (var j in games[i].keyImages){
                if (games[i].keyImages[j].type === "OfferImageWide"){
                    game.imgURL = games[i].keyImages[j].url;
                }
            }
            console.log(game.title + " game object has been created");
        }
    }   
}

//"2021-01-29T16:00:00.000Z"
async function createEmbed(){
    //Add info into Embed
    await getGameData();
    freeGameEmbed = new Discord.MessageEmbed()
    .setColor('#4296f5')
    .setTitle(game.title)
    .setURL(game.webURL)
    .setDescription("⬆️ Free Now on Epic Games Store ⬆️")
    .setImage(game.imgURL)
    .setTimestamp(new Date(game.expiryDate))
    .setFooter("Free until");
    console.log("Created Embed");
    return freeGameEmbed;
}

// Sends to every server connected once a week
// TO DO: Add Cron to this function
async function perServerSend(){
    var guildList = bot.guilds.cache.array();
    for await (const guild of guildList) {
        await sendFreeGame(guild);
    };
}

async function sendFreeGame (guild) {

    console.log(guild.name);
    let data = await cache[guild.id];
    if (!data) {
        cache[guild.id] = data = await getChannel(guild);
        console.log(data);
    }
    const channelId = data;
    const channel = guild.channels.cache.get(channelId);  
    if (channel){
        
        console.log("channel exists: " + channel.id);     
    }
    if (await checkChannel(guild, channel) === true) { channel.send(await createEmbed()); }
}

function getChannel (guild){
    return new Promise((resolve, reject) => {
        try {
            var db = new sqlite3.Database('./.data/ludumliberum.db');
            console.log("opening db for " + guild.name);
            db.serialize( function ()  {
                db.get(`SELECT channel_id
                    FROM guilds
                    WHERE guild_id = ?`, [guild.id], 
                    (err, row) => {
                        if (err) {
                            reject (console.error(err.message));
                        }
                        console.log(row);
                        if (row === undefined){
                            db.close();
                            resolve();
                        } else {
                            let chId = row.channel_id;
                            db.close();
                            console.log("found channel: " + chId);
                            resolve (chId);
                        }
                })
            });   
        } catch (error){
            reject();
        }
    });
}

async function checkChannel(guild, channel){
    //const channel = await guild.channels.cache.find (ch => ch.id === cache[guild.id] && ch.type === 'text');
    if (!channel){
        const fetchlogs = await guild.fetchAuditLogs({ 
            type: 'BOT_ADD'
        });
        console.log("checking logs");
        const botLog = fetchlogs.entries.find (logs => logs.target.id === bot.user.id);
        console.log("Target Acquired! in " + guild.name + ", could not find channel");
        botLog.executor.send("Could not find right channel in " + guild.name + ".\nPlease update the channel on your server using the `LL!setChannel` command in the channel you want to use");
        return false;
    }  else {
        console.log(channel.name);
    }
    return true;
}

async function setChannel (message){
    const { member, channel, guild } = message;

    if (!member.hasPermission('ADMINISTRATOR')) {
      channel.send('You do not have permission to run this command.');
      return;
    }
    saveToDB(guild, channel);
    channel.send({"content": "This is now the default channel. Here is the free game of the week:", "embed": await createEmbed()});
}

function saveToDB (guild, channel){
    var db = new sqlite3.Database('./.data/ludumliberum.db');
    cache[guild.id] = [channel.id];
    db.serialize(function () {
        db.run(`CREATE TABLE IF NOT EXISTS guilds (
            guild_id text PRIMARY KEY,
            channel_id text
        )`)
        .run(`REPLACE INTO guilds (guild_id, channel_id)
            VALUES ('${guild.id}', '${channel.id}')
        `, (err) => {
            if (err) console.log(err);
            db.close((err) => {
                if (err) {
                return console.error(err.message);
                }
            });
        });
    });
}

// // Cron scheduled job at 6am every friday
// var job = new CronJob('0 6 * * FRI', function () {

//     checkFreeGame();
// }, null, true, 'Pacific/Auckland');
// job.start();

bot.login(token);