const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;

require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    console.log(`[REQUEST RECEIVED]: ${req.method} ${req.url}`);
    next();
});

const logger = (req, res, next) => {
    console.log('logger middleware logged', req.params);
    next();
};


const uri = process.env.MONGO_DB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect();

        const database = client.db("hireloop");
        const jobs = database.collection("jobs");
        const companyCollection = database.collection("companies");
        const applicationsCollection = database.collection("applications");
        const planCollection = database.collection('plans');
        const subscriptionCollection = database.collection('subscription');
        // স্ক্রিনশট অনুযায়ী কালেকশনের নাম 'user'
        const userCollection = database.collection("user");
        const sessionCollection = database.collection("session");


        // verification related
        const verifyToken = async (req, res, next) => {
            console.log("VERIFY TOKEN STARTED");
            console.log("AUTH HEADER:", req.headers.authorization);
            // console.log('headers', req.headers)
            const authHeader = req.headers?.authorization

            if (!authHeader) {
                return res.status(401).send({ message: 'Unauthorized Access' })
            }

            const token = authHeader.split(' ')[1]

            if (!token) {
                return res.status(401).send({ message: 'Unauthorized access' })
            }

            const query = { token: token }
            const session = await sessionCollection.findOne(query)

            const userId = session.userId;
            console.log("userId of the session:", userId);

            const userQuery = {
                _id: userId
            }
            const user = await userCollection.findOne(userQuery);
            console.log('user id of the session', user)

            // // set data in the req object
            req.user = user;
            // console.log('Authorization:', req.headers.authorization);
            // console.log('Token:', token);
            // console.log('Session:', session);

            next();
        }

        // must be used after verifyToken middleware
        const verifySeeker = async (req, res, next) => {
            if (req.user?.role !== 'seeker') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        // Verify recruiter
        const verifyRecruiter = async (req, res, next) => {
            if (req.user?.role !== 'recruiter') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        // must be used after verifyToken middleware
        const verifyAdmin = async (req, res, next) => {
            console.log('User:', req.user);
            if (req.user.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }


        // Job related APIs
        app.get('/api/jobs', async (req, res) => {
            console.log('server side q', req.query);
            const query = {};
            // job filter related query
            if(req.query.type){
                query.type = req.query.type
            }
            if(req.query.category){
                query.category = req.query.category
            }

            // Company related query
            if (req.query.companyId) query.companyId = req.query.companyId;
            if (req.query.status) query.status = req.query.status;
            const result = await jobs.find(query).toArray();
            res.send(result);
        });

        app.get('/api/jobs/:id', async (req, res) => {
            const query = { _id: new ObjectId(req.params.id) };
            const result = await jobs.findOne(query);
            res.send(result);
        });

        // company related apis
        app.get('/api/companies', verifyToken, async (req, res) => {
            const cursor = companyCollection.find();
            const result = await cursor.toArray();
            res.send(result);
        });


        // --- নতুন যোগ করুন আপনার index.js ফাইলে ---
        // index.js এ এই রাউটটি বসান
        app.get('/api/my/companies', async (req, res) => {
            try {
                const recruiterId = req.query.recruiterId;
                const company = await companyCollection.findOne({ recruiterId: recruiterId });

                if (!company) {
                    // 404 এরর না দিয়ে 200 স্ট্যাটাসের সাথে null পাঠাচ্ছি
                    // এর ফলে ফ্রন্টএন্ড আর ক্র্যাশ করবে না!
                    return res.status(200).json(null);
                }

                res.status(200).json(company);
            } catch (error) {
                res.status(500).json({ error: error.message });
            }
        });

        // --- কোম্পানী সেভ করার জন্য পোস্ট রাউট ---
        app.post('/api/companies', async (req, res) => {
            try {
                const companyData = req.body;
                // 'companyCollection' টি আপনার আগে থেকেই ডিফাইন করা আছে (const companyCollection = database.collection("companies");)
                const result = await companyCollection.insertOne({
                    ...companyData,
                    createdAt: new Date()
                });

                res.status(201).json({ success: true, id: result.insertedId });
            } catch (error) {
                console.error("Error saving company:", error);
                res.status(500).json({ error: "Failed to save company" });
            }
        });

        // --- কোম্পানির তথ্য আপডেট করার রাউট ---
        app.put('/api/companies/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;

                // payload থেকে _id রিমুভ করা জরুরি যাতে আপডেট করার সময় কনফ্লিক্ট না হয়
                delete updateData._id;

                const result = await companyCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: "Company not found" });
                }
                res.status(200).json({ success: true });
            } catch (error) {
                console.error("Error:", error);
                res.status(500).json({ error: "Failed" });
            }
        });

        // --- নতুন জব পোস্ট করার জন্য পোস্ট রাউট ---
        app.post('/api/jobs', async (req, res) => {
            try {
                const jobData = req.body;
                // 'jobs' কালেকশনটি আপনার রান ফাংশনের শুরুতেই ডিফাইন করা আছে
                const result = await jobs.insertOne({
                    ...jobData,
                    createdAt: new Date()
                });

                res.status(200).json({ success: true, id: result.insertedId });
            } catch (error) {
                console.error("Error saving job:", error);
                res.status(500).json({ error: "Failed to save job" });
            }
        });

        app.patch('/api/companies/:id', logger, verifyToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            console.log("ID received in server:", id); // ১. আইডি চেক
            console.log("Body received in server:", req.body); // ২. বডি চেক
            const updatedCompany = req.body;
            const filter = { _id: new ObjectId(id) }
            const updatedDoc = {
                $set: {
                    status: updatedCompany.status
                }
            }
            const result = await companyCollection.updateOne(filter, updatedDoc)
            console.log("MongoDB Result:", result);
            res.send(result)
        })



        // User related API - সঠিক কালেকশন ব্যবহার করা হয়েছে
        // ইউজার ফেচ করার রাউট
        app.get('/api/users/:id', async (req, res) => {
            try {
                const id = req.params.id;
                // আইডি স্ট্রিং নাকি অবজেক্ট আইডি তা চেক করে খোঁজা
                const user = await userCollection.findOne({ _id: new ObjectId(id) });
                res.status(200).json(user);
            } catch (error) {
                res.status(500).json({ error: "Server Error" });
            }
        });

        app.post('/api/users/update-plan', async (req, res) => {
            try {
                const { userId, planId } = req.body;
                console.log("DEBUG 4: API Received Update Request for User:", userId, "Plan:", planId);
                // এখানেও 'user' কালেকশন ব্যবহার করতে হবে
                const result = await userCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { plan: planId } }
                );
                console.log("DEBUG 5: MongoDB Update Result (Matched):", result.matchedCount);
                res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
            } catch (error) {
                console.error("DEBUG Error:", error);
                res.status(500).json({ error: "Failed to update plan" });
            }
        });

        // Application related API
        app.get('/api/applications', verifyToken, verifySeeker, async (req, res) => {
            console.log("=== APPLICATION API HIT ===");

            console.log("REQ USER:", req.user);

            console.log("QUERY:", req.query);
            const query = {};
            if (req.query.applicantId && req.query.applicantId !== 'undefined') {
                query.applicantId = req.query.applicantId;


                // check whether asking for user information or someone else
                console.log(req.user, req.query.applicantId)
                if (req.user._id.toString() !== req.query.applicantId) {
                    return res.status(403).send({ message: 'forbidden access' })
                }
            }
            const result = await applicationsCollection.find(query).toArray();

            res.send(result);
        });

        app.post('/api/applications', async (req, res) => {
            const newApp = { ...req.body, createdAt: new Date() };
            const result = await applicationsCollection.insertOne(newApp);
            res.send(result);
        });

        // subscription related API
        app.post('/api/subscriptions', async (req, res) => {
            try {
                const subsInfo = { ...req.body, createdAt: new Date() };
                const result = await subscriptionCollection.insertOne(subsInfo);
                res.status(200).json({ success: true, insertedId: result.insertedId });
            } catch (error) {
                res.status(500).json({ error: "Failed to save subscription" });
            }
        });

        // Plans
        app.get('/api/plans', async (req, res) => {
            const query = req.query.plan_id ? { id: req.query.plan_id } : {};
            const plan = await planCollection.findOne(query);
            res.send(plan);
        });

        console.log("MongoDB Connection Successful and routes initialized!");
    } catch (error) {
        console.error("MongoDB Connection Failed:", error);
    }
}

run().catch(console.dir);

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});