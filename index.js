import dotenv from "dotenv";
import fs from "fs";
import cron from "node-cron";
import puppeteer from "puppeteer";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();

async function run() {
    const browser = await puppeteer.launch({
        slowMo: 50,
        headless: "new",
        args: ['--no-sandbox']
    });

    const page = await browser.newPage();

    console.log("Collecting Best Players ...");
    const players = await collectBestPlayers(page);

    await wait(1000);

    console.log("Filtering players ...");
    const filteredPlayers = await filterPlayers(page, players);

    console.log("Building tweet ...");
    const tweet = buildTweet(filteredPlayers);

    await sendTweet(tweet);

    await browser.close();
}

async function collectBestPlayers(page) {
    try {
        await page.goto("https://www.footballdatabase.eu/fr/joueurs", {
            waitUntil: "load",
        });
    } catch (e) {
        await page.screenshot({
            path: "screenshots/error.jpg",
            fullPage: true,
        });
    }

    await wait(2000);

    const collectedPlayers = [];

    console.log("Collect PlayerRows ...");
    const playerRows = await page.$$(".pbestscorers:nth-child(2) .line");

    if (!playerRows.length) throw new Error("Best players not found");

    for (let index = 2; index < playerRows.length + 2; index++) {
        // Get the player's country
        const playerCountryName = await page.evaluate(
            (data) => {
                const playerFlag = document.querySelector(
                    `.pbestscorers:nth-child(2) .line:nth-child(${data.index}) span.real_flag`
                );
                if (playerFlag) {
                    return playerFlag.getAttribute("title");
                } else {
                    return null;
                }
            },
            { index }
        );

        // Get the player's name
        const playerNameButton = await page.$(
            `.pbestscorers:nth-child(2) .line:nth-child(${index}) > .player > a`
        );
        const playerFullName = (await playerNameButton.getProperty(
            "textContent"
        ))
            .toString()
            .replace("JSHandle:", "")
            .trim();

        // Get the player's goal count
        const playerGoalCountButton = await page.$(
            `.module:nth-child(2) .line:nth-child(${index}) > .score > a`
        );
        const playerGoalCount = (await playerGoalCountButton.getProperty(
            "textContent"
        ))
            .toString()
            .replace("JSHandle:", "")
            .trim();

        const player = {
            fullName: playerFullName,
            lastName: playerFullName.split(" ").pop(),
            country: playerCountryName,
            goalCount: +playerGoalCount,
        };

        collectedPlayers.push(player);
    }

    return collectedPlayers;
}

async function filterPlayers(page, players) {
    await page.goto(
        "https://www.maxifoot.fr/classement-buteur-europe-annee-civile-2023.htm",
        { waitUntil: "load" }
    );

    await wait(2000);

    const validPlayersLastNames = [];

    const playerRows = await page.$$("tr .jou1 > b");

    for (const playerRow of playerRows) {
        const playerName = (await playerRow.getProperty("textContent"))
            .toString()
            .replace("JSHandle:", "")
            .trim();

        const playerLastName = playerName.split(" ").pop();

        if (playerLastName) {
            validPlayersLastNames.push(playerLastName.toLowerCase());
        }
    }

    return players.filter((player) =>
        validPlayersLastNames.includes(player.lastName.toLowerCase())
    );
}

function buildTweet(filteredPlayers) {
    const tweetLignes = ["❌ No.\n\nClosest players in 2023 :\n\n"];

    for (let index = 0; index < filteredPlayers.length; index++) {
        if (index > 4) break;

        const player = filteredPlayers[index];

        tweetLignes.push(`${player.fullName} - ${player.goalCount} ⚽️\n`);
    }

    return tweetLignes.join().replace(/[","]/g, "");
}

async function sendTweet(tweet) {
    console.log(tweet);

    if (process.env.NODE_ENV === "development") return;

    try {
        const client = new TwitterApi({
            appKey: process.env.API_KEY,
            appSecret: process.env.API_SECRET,
            accessToken: process.env.ACCESS_TOKEN,
            accessSecret: process.env.ACCESS_SECRET,
        });

        const twitterClient = client.readWrite;

        await twitterClient.v2.tweet(tweet);
    } catch (e) {
        console.log("Failed to send tweet.", e);
    }
}

cron.schedule("5 0 * * *", async () => {
    try {
        await run();
    } catch (error) {
        createErrorLogFile(error)
    }
});

async function wait(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

function createErrorLogFile(text) {
    const date = new Date()
    
    fs.appendFile(
        `logs/${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-error-logs-${date.getTime()}.txt`, 
        text.toString(), 
        function (err) {
            if (err) throw err;
            console.log('An error happened ! You can access error logs in the log folder !');
        }
    )
}
