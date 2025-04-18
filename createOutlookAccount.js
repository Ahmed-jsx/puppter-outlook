const puppeteer = require('puppeteer');
const puppeteerExtra = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

puppeteerExtra.use(StealthPlugin());

// Helper function to pause execution
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Random data generators
function generateRandomUsername() {
    const randomSuffix = Math.floor(Math.random() * 1000000);
    return `user${randomSuffix}`; // Simple prefix for demonstration
}

function generateRandomPassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < 12; i++) {
        password += chars[Math.floor(Math.random() * chars.length)];
    }
    return password; // Ensures at least 8 characters with variety
}

// CAPTCHA solver (using 2Captcha as an example)
async function solveCaptcha(siteKey, pageUrl) {
    console.log('🧠 Sending CAPTCHA to 2Captcha...');
    const response = await axios.get(
        `http://2captcha.com/in.php?key=${process.env.CAPTCHA_API_KEY}&method=userrecaptcha&googlekey=${siteKey}&pageurl=${pageUrl}&json=1`
    );
    const requestId = response.data.request;

    let captchaSolution;
    for (let i = 0; i < 24; i++) {
        await sleep(5000);
        const result = await axios.get(
            `http://2captcha.com/res.php?key=${process.env.CAPTCHA_API_KEY}&action=get&id=${requestId}&json=1`
        );
        if (result.data.status === 1) {
            captchaSolution = result.data.request;
            break;
        }
    }

    if (!captchaSolution) throw new Error('Failed to solve CAPTCHA in time.');
    console.log('✅ CAPTCHA solved.');
    return captchaSolution;
}

// Selectors based on inferred HTML structure (update with actual selectors)
const SELECTORS = {
    getNewEmail: '#liveSwitch',
    emailPrefix: '#usernameInput',         // Email prefix input
    nextButton: '#nextButton',                    // Next button 
    passwordInput: 'input[name="Password"]',         // Password input
    firstNameInput: 'input[name="firstNameInput"]',       // First name input
    lastNameInput: 'input[name="lastNameInput"]',         // Last name input
    // countrySelect: 'select[name="Country"]',         // Country dropdown
    birthMonthSelect: 'select[name="BirthMonth"]',   // Birth month dropdown
    birthDaySelect: 'select[name="BirthDay"]',       // Birth day dropdown
    birthYearInput: 'input[name="BirthYear"]',       // Birth year input
    errorAlert: 'div[role="alert"]',                 // Error message indicator
};

// Function to create a single Outlook account
async function createOutlookAccount() {
    const browser = await puppeteerExtra.launch({
        headless: true, // Set to false for debugging
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        defaultViewport: null,
    });
    const page = await browser.newPage();

    try {
        // Step 1: Navigate to the signup page
        await page.goto('https://signup.live.com', { waitUntil: 'networkidle2' });
        console.log('🌐 Loaded signup page:', page.url());

        // Step 2: Click "Get a new email address"
        await page.waitForSelector(SELECTORS.getNewEmail, { timeout: 60000 });
        await page.click(SELECTORS.getNewEmail);
        console.log('🔗 Clicked "Get a new email address"');

        // Step 3: Enter email prefix and select domain
        let prefix, domain, fullEmail;
        let emailValid = false;
        const EMAIL_DOMAINS = ['outlook.com', 'hotmail.com'];
        while (!emailValid) {
            prefix = generateRandomUsername();
            domain = EMAIL_DOMAINS[Math.floor(Math.random() * EMAIL_DOMAINS.length)];
            fullEmail = `${prefix}@${domain}`;

            await page.waitForSelector(SELECTORS.emailPrefix, { timeout: 60000 });
            await page.type(SELECTORS.emailPrefix, prefix, { delay: 100 });
            await page.click(SELECTORS.nextButton);

            try {
                await page.waitForSelector(SELECTORS.passwordInput, { timeout: 60000 });
                emailValid = true;
                console.log(`✅ Email ${fullEmail} accepted`);
            } catch {
                const error = await page.$(SELECTORS.errorAlert);
                if (error) {
                    console.log(`Email ${fullEmail} is taken. Retrying...`);
                    await page.evaluate((sel) => document.querySelector(sel).value = '', SELECTORS.emailPrefix);
                } else {
                    throw new Error('Unexpected state after email entry');
                }
            }
        }

        // Step 4: Enter password
        const password = generateRandomPassword();
        await page.type(SELECTORS.passwordInput, password, { delay: 100 });
        await page.click(SELECTORS.nextButton);
        console.log('🔑 Password entered');

        // Step 5: Enter first and last name
        await page.waitForSelector(SELECTORS.firstNameInput, { timeout: 60000 });
        await page.type(SELECTORS.firstNameInput, 'John', { delay: 100 });
        await page.type(SELECTORS.lastNameInput, 'Doe', { delay: 100 });
        await page.click(SELECTORS.nextButton);
        console.log('📛 Name entered');

        // Step 6: Select country and enter birthdate
        await page.waitForSelector(SELECTORS.birthDaySelect, { timeout: 60000 });
        // await page.select(SELECTORS.countrySelect, 'EG'); // Egypt
        await page.select(SELECTORS.birthMonthSelect, '1'); // January
        await page.select(SELECTORS.birthDaySelect, '1'); // 1st
        await page.type(SELECTORS.birthYearInput, '1990', { delay: 100 });
        await page.click(SELECTORS.nextButton);
        console.log('🎂 Birthdate and region entered');

        // Step 7: Handle CAPTCHA (if present)
        try {
            await page.waitForSelector('iframe[src*="api2/anchor"]', { timeout: 10000 });
            const frame = page.frames().find(f => f.url().includes('api2/anchor'));
            const siteKey = await frame.$eval('.g-recaptcha', el => el.getAttribute('data-sitekey'));

            const captchaResponse = await solveCaptcha(siteKey, page.url());
            await page.evaluate((token) => {
                document.querySelector('#g-recaptcha-response').value = token;
            }, captchaResponse);

            await page.click(SELECTORS.nextButton);
            console.log('🤖 CAPTCHA solved');
        } catch (e) {
            console.log('ℹ️ No CAPTCHA detected or already handled');
        }

        // Step 8: Verify account creation
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 });
        if (page.url().includes('outlook.live.com')) {
            const entry = { email: fullEmail, password, createdAt: new Date().toISOString() };
            fs.appendFileSync('accounts.json', JSON.stringify(entry) + ',\n');
            console.log(`🎉 Created account: ${fullEmail}`);
        } else {
            throw new Error('Account creation failed');
        }

    } catch (err) {
        console.error('❌ Error during account creation:', err.message);
    } finally {
        await browser.close();
    }
}

// Bulk creation loop
const TOTAL_ACCOUNTS = 3; // Adjust as needed
(async () => {
    for (let i = 1; i <= TOTAL_ACCOUNTS; i++) {
        console.log(`\n🚀 Creating account ${i} of ${TOTAL_ACCOUNTS}`);
        await createOutlookAccount();
        await sleep(5000); // Avoid rate limiting
    }
})();