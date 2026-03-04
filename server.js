const express = require('express');
const axios = require('axios');
const WebSocket = require('ws');

const app = express();
app.use(express.json());
app.use(express.static('public'));

// CHANGE THIS to your speaker IP
const SPEAKER_IP = "192.168.1.169";

app.get('/power', async (req, res) => {

    const xml =
`<key state="press" sender="Gabbo">POWER</key>`;

    try {

        await axios.post(
            `http://${SPEAKER_IP}:8090/key`,
            xml,
            {
                headers:{
                    'Content-Type':'application/xml'
                }
            }
        );

        res.send("Power toggled");

    } catch {

        res.send("Error");

    }

});

app.get('/mute', async (req, res) => {

    const xml =
`<key state="press" sender="Gabbo">MUTE</key>`;

    try {

        await axios.post(
            `http://${SPEAKER_IP}:8090/key`,
            xml,
            {
                headers:{
                    'Content-Type':'application/xml'
                }
            }
        );

        res.send("Mute toggled");

    } catch {

        res.send("Error");

    }

});

// Get speaker status
app.get('/status', async (req, res) => {

    try {

        const nowPlaying = await axios.get(
            `http://${SPEAKER_IP}:8090/now_playing`
        );

        const volume = await axios.get(
            `http://${SPEAKER_IP}:8090/volume`
        );

        const xml = nowPlaying.data;
        const volXml = volume.data;


        function extract(tag){

            const match = xml.match(
                new RegExp(`<${tag}>(.*?)</${tag}>`)
            );

            return match ? match[1] : "";
        }


        const track = extract("track");
        const artist = extract("artist");
        const album = extract("album");
        const status = extract("playStatus");


        const volumeMatch =
            volXml.match(/<actualvolume>(.*?)<\/actualvolume>/);

        const volumeLevel =
            volumeMatch ? volumeMatch[1] : 0;



        // UNIVERSAL SOURCE DETECTION

        let source = "unknown";
        let wifiType = null;



        // AUX

        if(xml.includes("AUX IN")){

            source = "aux";

        }


        // Internet Radio

        else if(xml.includes("RADIO_STREAMING")){

            source = "wifi";
            wifiType = "radio";

        }


        // Spotify Connect

        else if(xml.includes("spotify:")){

            source = "wifi";
            wifiType = "spotify";

        }


        // AirPlay

        else if(xml.includes("AirPlay")){

            source = "wifi";
            wifiType = "airplay";

        }


        // Bluetooth

        else if(track || artist){

            source = "bluetooth";

        }



        res.json({

            source,
            wifiType,

            track,
            artist,
            album,

            status,

            volume: volumeLevel

        });

    }

    catch{

        res.json({

            error: "Speaker offline"

        });

    }

});

// Volume control
app.get('/volume/:level', async (req, res) => {

    const level = req.params.level;

    const xml = `
<volume>${level}</volume>
`;

    try {

        await axios.post(
            `http://${SPEAKER_IP}:8090/volume`,
            xml,
            {
                headers: {
                    'Content-Type': 'application/xml'
                }
            }
        );

        res.send("Volume Set");

    } catch {

        res.send("Error");

    }

});

app.get('/play', async (req, res) => {

    const xml = `<key state="press" sender="Gabbo">PLAY</key>`;

    try {

        await axios.post(
            `http://${SPEAKER_IP}:8090/key`,
            xml,
            {
                headers: {
                    'Content-Type': 'application/xml'
                }
            }
        );

        res.send("Play Sent");

    } catch {

        res.send("Error");

    }

});

const server = app.listen(3000, () => {

    console.log("SoundTouch Server Running");

});


const wss = new WebSocket.Server({ server });

async function getStatus(){

    try{

        const nowPlaying = await axios.get(
            `http://${SPEAKER_IP}:8090/now_playing`
        );

        const volume = await axios.get(
            `http://${SPEAKER_IP}:8090/volume`
        );


        const xml = nowPlaying.data;
        const volXml = volume.data;


        function extract(tag){

            const match = xml.match(
                new RegExp(`<${tag}>(.*?)</${tag}>`)
            );

            return match ? match[1] : "";
        }


        const track = extract("track");
        const artist = extract("artist");
        const album = extract("album");
        const status = extract("playStatus");


        const volumeMatch =
            volXml.match(/<actualvolume>(.*?)<\/actualvolume>/);

        const volumeLevel =
            volumeMatch ? volumeMatch[1] : 0;



        let source="unknown";
        let wifiType=null;


        if(track==="AUX IN")
            source="aux";

        else if(xml.includes("RADIO_STREAMING")){
            source="wifi";
            wifiType="radio";
        }

        else if(xml.includes("spotify:")){
            source="wifi";
            wifiType="spotify";
        }

        else if(xml.includes("AirPlay")){
            source="wifi";
            wifiType="airplay";
        }

        else if(track || artist)
            source="bluetooth";



        return{

            source,
            wifiType,

            track,
            artist,
            album,

            status,

            volume:volumeLevel

        };

    }

    catch{

        return{
            error:"offline"
        };

    }

}

setInterval(async ()=>{

    const status=await getStatus();

    wss.clients.forEach(client=>{

        if(client.readyState===1){

            client.send(
                JSON.stringify(status)
            );

        }

    });

},1000);