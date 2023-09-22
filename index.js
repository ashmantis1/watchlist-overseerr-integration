const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const { JSDOM } = require('jsdom');
const puppeteer = require('puppeteer');
require('dotenv').config();

let db = new sqlite3.Database('./titles.db');
const jellyseerrAPI = process.env.OVERSEERR_API_URL + "/api/v1";
const jellyseerrAPIKey = process.env.OVERSEERR_API_KEY; 
const watchlistURL = "https://www.google.com/collections/s/list/beVVBviyfvpRJBJkqtgCru_qG1P41g/23J1HXUNruA";
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
    let titles = await getTitles();
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
                        requestMedia(await searchMedia(element));
                    }
                    catch (error) {
                        console.log(error);
                        console.log("Media Request failed")
                    }
                }
                else {
                    // Janky database intialisation
                    console.log("First titles added, waiting 30 seconds till next poll");
    
                }


            }
        });
    }
    console.log(`Completed Polling, waiting ${process.env.POLL_INTERVAL} seconds till next poll`);
    db.close(); 


    // Sleep for 30 seconds and call recursively
    setTimeout(main, parseInt(process.env.POLL_INTERVAL) * 1000);
  }






// Sends request to jellyseerr
function requestMedia(media) {
    console.log(media.mediaType)
    axios.post(jellyseerrAPI + '/request',{
        mediaType: media.mediaType,
        mediaId: media.mediaId,
        seasons: media.seasons, 

    }, {
        headers: {
            'X-Api-Key': jellyseerrAPIKey
        }    
    })
    .then(function (response) {
        console.log(response.data);
      })
    .catch(function (error) {
    console.log(error.response);
    });
}

// Searchs for  ID and other relevant info for media 
async function searchMedia(name){


    try {
        let media = await getMediaInfo(name);
        // Variable of name with all special characters removed 
        let nameClean = encodeURIComponent(media.title); 
        let type = media.type;
        let year = media.year;
        console.log("TYPE: " + type)
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

// async function getNoSeasons(id){
//     try {
//         const response = await axios.get(`https://api.themoviedb.org/3/tv/${id}`, {
//             headers: {
//                 Authorization: `Bearer ${process.env.TMDB_API_KEY}`
//             }
//         });   
//         return parseInt(response.data.number_of_seasons);
    
//     } catch (err) { console.log(err); }
    
// }


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
// Gets required info from google watchlist and aggregates it into an object
async function getMediaInfo(name){
    try{
        let titles = await getTitles();
        let links = await getLinks();
        let titleIndex = titles.indexOf(name);

        let media = await scrapeMediaInfo(links[titleIndex]); 
        let title = titles[titleIndex];


        return {title: title, year: media.year, type: media.type};
    }
    catch (error){
       return {};
    }

}

// Get titles from Google watchlist 

async function getTitles () {
    const response = await axios.get(watchlistURL); 
    return new Promise((resolve, reject) => {
        try {
            
            let HTML = response.data; 

            const { document } = new JSDOM(HTML).window
            
            const docs = document.querySelectorAll("span[jsname='r4nke']");
            let array = Array.from(docs);
            let titles =  array.map(titles => titles.textContent);
            
            resolve(titles);
        } catch (err) { reject(err); }
    }); 
}

// Get all links to google page for each item in watchlist
async function getLinks(){
    const response = await axios.get(watchlistURL); 
    return new Promise((resolve, reject) => {
        try {
                    
            let HTML = response.data; 

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
            if(text.includes("season")){
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


async function test(){
   // console.log(await scrapeMediaInfo("https://www.google.com/search?q=2001:+A+Space+Odyssey&stick=H4sIAAAAAAAAAONgVuLQz9U3sEguMQMAg3lAcgwAAAA"));

    // try {
    //     let token = await tvdbLogin();
    //     const response = await axios.get("https://api4.thetvdb.com/v4/search?query=The Peripheral", {
    //         headers: {
    //             Authorization: `Bearer ${token}`
    //         }
    //     });   
    //     console.log(response.data.data[0].id);
    
    // } catch (err) { console.log(err); }
    // tvdbToken = await tvdbLogin();
    // console.log(await getNoSeasons("71663"))
    console.log(await scrapeMediaInfo("https://www.google.com/search?q=The+Peripheral&stick=H4sIAAAAAAAAAONgVuLQz9U3sEguMQMAg3lAcgwAAAA"));
    
}
//test(); 
  main();

