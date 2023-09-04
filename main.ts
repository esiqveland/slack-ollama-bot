require('dotenv').config()
import app from './src/app'

(async () => {
    try {
        // Start your app
        const port = process.env.PORT || 3000
        await app.start(port)
        console.log('⚡️ Bolt app is running on port: ' + port);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
