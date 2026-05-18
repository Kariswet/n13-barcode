import {
    BrowserMultiFormatReader
} from 'https://cdn.jsdelivr.net/npm/@zxing/browser@latest/+esm';

const codeReader = new BrowserMultiFormatReader();

const resultElement = document.getElementById('result');
const videoElement = document.getElementById('video');

let scannerLocked = false;
let lastDetectedBarcode = null;

// beep sound
const beepSound = new Audio(
    'https://actions.google.com/sounds/v1/cartoon/beep_short.ogg'
);

async function startScanner() {

    const devices =
        await BrowserMultiFormatReader.listVideoInputDevices();

    const selectedDeviceId = devices[0].deviceId;

    codeReader.decodeFromVideoDevice(
        selectedDeviceId,
        videoElement,
        async (result, err) => {

            // if barcode detected
            if (result) {

                const barcode = result.getText();

                // ignore if scanner locked
                if (
                    scannerLocked &&
                    barcode === lastDetectedBarcode
                ) {
                    return;
                }

                // lock scanner
                scannerLocked = true;

                // save latest barcode
                lastDetectedBarcode = barcode;

                console.log("SCANNED:", barcode);

                // play beep
                beepSound.play();

                try {

                    const response = await fetch(
                        `http://127.0.0.1:7300/product/${barcode}`
                    );

                    const data = await response.json();

                    if (data.error) {

                        resultElement.innerText =
                            "Product not found";

                    } else {

                        resultElement.innerText =
                            `${data.name} - Rp${data.price}`;
                    }

                } catch (error) {

                    console.error(error);

                    resultElement.innerText =
                        "API Error";
                }
            }

            // barcode disappears
            else {

                // unlock scanner
                scannerLocked = false;
                lastDetectedBarcode = null;
            }
        }
    );
}

startScanner();