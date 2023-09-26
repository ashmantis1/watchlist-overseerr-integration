const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
require('dotenv').config();

let db = new sqlite3.Database('./titles.db');
const jellyseerrAPI = process.env.OVERSEERR_API_URL + "/api/v1";
const jellyseerrAPIKey = process.env.OVERSEERR_API_KEY; 
const watchlistURL = process.env.WATCHLIST_URL; 
db.serialize(() => {
    db.run("CREATE TABLE IF NOT EXISTS titles (title TEXT)");
});

if (!process.env.POLL_INTERVAL) {
    console.log("POLL_INTERVAL not set, exiting")
    process.exit();
}
if (!process.env.TMDB_API_KEY) {
    console.log("TMDB_API_KEY not set, exiting")
    process.exit();
}
if (!process.env.OVERSEERR_API_URL) {
    console.log("OVERSEERR_API_URL not set, exiting")   
    process.exit();
}
if (!process.env.OVERSEERR_API_KEY) {
    console.log("OVERSEERR_API_KEY not set, exiting")
    process.exit();
}
async function main() {

    db = new sqlite3.Database('./titles.db');
    let watchlistData = await getTitles();
    let titles = watchlistData.titles;
    let links  = watchlistData.links;
    let count = await getTitleCount(db);
    // Check if there's a new title in the list

    if(count < titles.length){
        titles.forEach(async element => { 
            // Only insert into DB if title is new
            if (await isNewTitle(db, element)){
                // Insert title into DB
                const title = db.prepare("INSERT INTO titles VALUES (?)");
                title.run(element);
                title.finalize();
                // Request only if database is populated and request is new
                if (count > 0) {
                    try {
                        requestMedia(await searchMedia(element, links, titles));
                    }
                    catch (error) {
                        console.log(error);
                        console.log("Media Request failed")
                    }
                }


            }
        });
    }
    else if (count > titles.length) {
        let dbTitles = await getTitlesFromDB(db);
        let dbArr = dbTitles.map(title => title['title']);
        // Delete titles that have been removed from watchlist
        // TODO: Fix issue where titles are not requested if added right after another title is being removed, causing count to be the same as dbArr.length
        dbArr.forEach( element => {
            if (!titles.includes(element)) {
                const deleteQuery = db.prepare("DELETE FROM titles WHERE title = ?");
                console.log(`Deleting ${element}`)
                deleteQuery.run(element);
                deleteQuery.finalize();
            }
        }) 
    }
    if (count == 0) {
        console.log("Database is empty, populating with titles from watchlist");
    }
    //console.log(`Completed Polling, waiting ${process.env.POLL_INTERVAL} seconds till next poll`);
    db.close(); 

    let delay = (parseInt(process.env.POLL_INTERVAL) * 1000) * (Math.random()+1);

    // Sleep and call recursively
    setTimeout(main, delay);
  }






// Sends request to jellyseerr
function requestMedia(media) {
    console.log(`New Request: \n Type: ${media.mediaType} \n ID: ${media.mediaId}`);
    axios.post(jellyseerrAPI + '/request', {
        mediaType: media.mediaType,
        mediaId: media.mediaId,
        seasons: media.seasons, 

    }, {
        headers: {
            'X-Api-Key': jellyseerrAPIKey
        }    
    })
    .then(function (response) {
        console.log("Media Requested Sucessfully")
        console.log(response.data);
      })
    .catch(function (error) {
    console.log(error.response);
    });
}

// Searchs for  ID and other relevant info for media - Takes name of media, array of links to google pages and array of titles
async function searchMedia(name, links, titles){


    try {

        let titleIndex = titles.indexOf(name);
        let media = await scrapeMediaInfo(links[titleIndex]); 
        
        // Variable of name with all special characters removed 
        let nameClean = encodeURIComponent(name); 
        let type = media.type;
        let year = media.year;
        // Set ID based on media type 
        let id = type == "tv" ?  await getTvID(nameClean, year) : await getMovieID(nameClean, year);
        let output = {
            mediaType: type, 
            mediaId: id, 
            seasons: [1], 

        }
        return output; 
    }
    catch (error) {
        console.log(error);
    }

}


// Get ID of movie from TMDB 
async function getMovieID(name, year){

    try {
        const movie = await axios.get(`https://api.themoviedb.org/3/search/movie?query=${name}&year=${year}`, {
             headers: {
             Authorization: `Bearer ${process.env.TMDB_API_KEY}`
            }
        }); 
        return movie.data.results[0].id; 
    
    } catch (err) { console.log(err); }
 
}

// Get ID of TV show from TMDB
async function getTvID(name, year){

    try {
        const tv = await axios.get(`https://api.themoviedb.org/3/search/tv?query=${name}&year=${year}`, {
             headers: {
             Authorization: `Bearer ${process.env.TMDB_API_KEY}`
            }
        }); 
        return tv.data.results[0].id; 
    
    } catch (err) { console.log(err); }
 
}


// Gets total number of titles in DB 
async function getTitleCount(db) {

    return new Promise((resolve, reject) => {
        db.get("SELECT count(title) FROM titles",(err, row) => {
            if (err) reject(err); // I assume this is how an error is thrown with your db callback
            resolve(row['count(title)']);
        });
    });
}

// Checks if Title is new in the database
async function isNewTitle(db, title) {
    return new Promise((resolve, reject) => {
        let query = `SELECT title FROM titles WHERE title = ?`;
        db.get(query,[title],(err, row) => {
            if (err) reject(err); // I assume this is how an error is thrown with your db callback
            if(row ) {
                resolve(false);
            }
            else{
                resolve(true);
            }
            
        });
    });
}

// Get all titles from DB
async function getTitlesFromDB(db) {
    return new Promise((resolve, reject) => {
        let query = `SELECT title FROM titles`;
        db.all(query,(err, rows) => {
            if (err) reject(err); // I assume this is how an error is thrown with your db callback
            resolve(rows);
        });
    });
}


// Get titles from Google watchlist 

async function getTitles () {
    const response = await axios.get(watchlistURL); 
    return new Promise(async (resolve, reject) => {
        try {
            
            let HTML = response.data; 

            const { document } = new JSDOM(HTML).window
            
            const docs = document.querySelectorAll("span[jsname='r4nke']");
            let array = Array.from(docs);
            let titles =  array.map(titles => titles.textContent);
            
            resolve({titles: titles, links: await getLinks(HTML)});
        } catch (err) { reject(err); }
    }); 
}

// Get all links to google page for each item in watchlist
async function getLinks(HTML){
    return new Promise((resolve, reject) => {
        try {
                    
            const { document } = new JSDOM(HTML).window
            
            const divs = document.getElementsByClassName("EHB20b");
            let linksTemp = Array.from(divs).map(link => link.getElementsByTagName("a"));
            let links = [];
            linksTemp.forEach((element) => {
                links.push(element.item(0).href)
            }); 

            resolve(links);
        } catch (err) { reject(err); }
    });
}

async function scrapeMediaInfo(url){
    const browser = await puppeteer.launch({headless: 'new'});
    const page = await browser.newPage();
    await page.goto(url);
    let media = await page.evaluate(() => {
        // Get all spans in info box 
        let spans = document.getElementsByClassName("iAIpCb PZPZlf")[0].childNodes;
        let year; 
        let mediaType; 

        // Iterate through spans
        spans.forEach(element => {
            const yearPattern = /\b\d{4}\b/g;
            let text = element.textContent;
            if(text.includes("season") || text.includes ("series")){
                mediaType = "tv"; 
            }
            else {
                mediaType = "movie";
            }
            // Check if element contains a year
            if(text.match(yearPattern)){
                // Set date to first year found
                year = text.split(" ‧")[0].trimStart(); 
            }
           
        }); 
        return {year: year, type: mediaType};
    }); 

    await browser.close();
    return media;  

}


  main();

