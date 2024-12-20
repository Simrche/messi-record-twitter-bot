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
        args: ["--no-sandbox"],
    });

    const page = await browser.newPage();

    await page.setDefaultNavigationTimeout(60000);

    console.log("Collecting Best Players ...");
    const players = await collectBestPlayers(page);

    await wait(1000);

    console.log("Filtering players ...");
    const filteredPlayers = await filterPlayers(page, players);

    if (!filteredPlayers.length) {
        console.log("No players");
        return;
    }

    const bestPlayers = getBestPlayers(filteredPlayers);

    console.log("Building tweet ...");
    const tweet = buildTweet(filteredPlayers);

    await sendTweet(tweet, bestPlayers);

    await browser.close();
}

async function collectBestPlayers(page) {
    await page.goto("https://www.footballdatabase.eu/en/players", {
        waitUntil: "load",
    });

    await wait(5000);

    const collectedPlayers = [];

    console.log("Collect PlayerRows ...");
    const playerRows = await page.$$(".pbestscorers:nth-child(2) .line");

    if (!playerRows.length) throw new Error("Best players not found");

    console.log(playerRows.length + " players found");

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
        const playerFullName = (
            await playerNameButton.getProperty("textContent")
        )
            .toString()
            .replace("JSHandle:", "")
            .trim();

        // Get the player's goal count
        const playerGoalCountButton = await page.$(
            `.module:nth-child(2) .line:nth-child(${index}) > .score > a`
        );
        const playerGoalCount = (
            await playerGoalCountButton.getProperty("textContent")
        )
            .toString()
            .replace("JSHandle:", "")
            .trim();

        const player = {
            fullName: playerFullName,
            lastName: playerFullName.split(" ").pop(),
            country: playerCountryName,
            goalCount: +playerGoalCount,
        };

        console.log(player);

        collectedPlayers.push(player);
    }

    return collectedPlayers;
}

async function filterPlayers(page, players) {
    await page.goto(
        "https://www.maxifoot.fr/classement-buteur-europe-annee-civile-2-2024.htm",
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

function getBestPlayers(players) {
    const bestPlayerGoalCount = players[0].goalCount;

    return players.filter((player) => player.goalCount === bestPlayerGoalCount);
}

function buildTweet(filteredPlayers) {
    const tweetLignes = ["❌ No.\n\nClosest players in 2024 :\n\n"];

    for (let index = 0; index < filteredPlayers.length; index++) {
        if (index > 4) break;

        const player = filteredPlayers[index];

        tweetLignes.push(`${player.fullName} - ${player.goalCount} ⚽️\n`);
    }

    return tweetLignes.join().replace(/[","]/g, "");
}

async function sendTweet(tweet, bestPlayers) {
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

        const mediaIds = [];

        for (const player of bestPlayers) {
            try {
                const mediaId = await twitterClient.v1.uploadMedia(
                    `img/${player.lastName}.jpeg`
                );

                mediaIds.push(mediaId);
            } catch (error) {
                console.log("Player without picture:", player.lastName);
            }
        }

        await twitterClient.v2.tweet({
            text: tweet,
            media: {
                media_ids: mediaIds,
            },
        });
    } catch (e) {
        console.log("Failed to send tweet.", e);
    }
}

cron.schedule("5 22 * * *", async () => {
    try {
        await run();
    } catch (error) {
        createErrorLogFile(error);
    }
});

async function wait(duration) {
    return new Promise((resolve) => setTimeout(resolve, duration));
}

function createErrorLogFile(text) {
    const date = new Date();

    fs.appendFile(
        `logs/${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-error-logs-${date.getTime()}.txt`,
        text.toString(),
        function (err) {
            if (err) throw err;
            console.log(
                "An error happened ! You can access error logs in the log folder !"
            );
        }
    );
}
