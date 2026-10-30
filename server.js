require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const Transaction = require('./modals/transaction');
const app = express();
const Budget = require('./modals/budget'); // Budget model import karein
const axios =require('axios');
const SplitBill=require('./modals/splitBill')
const ErrorLog = require('./modals/ErrorLog');
const i18n = require('i18n');
const cookieParser = require('cookie-parser');

// Middleware setup ke andar:
app.use(cookieParser());


// Middleware setup
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// i18n Configuration
i18n.configure({
    locales: ['en', 'hi'],
    directory: __dirname + '/locales',
    defaultLocale: 'en',
    cookie: 'lang_code',
    objectNotation: true
});

app.use(i18n.init);

// Language Switcher Route
app.get('/change-lang/:lang', (req, res) => {
    res.cookie('lang_code', req.params.lang);
    res.redirect('/');
});

// Connect MongoDB
mongoose.connect("mongodb://localhost:27017/aiproject")
  .then(() => console.log(' Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Multer Setup for Image Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './public/uploads';
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

function fileToGenerativePart(filePath, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(filePath)).toString('base64'),
      mimeType
    },
  };
}

// Routes

// 1. Home Route: Dashboard & All Transactions
app.get('/', async (req, res) => {
  try {
    const transactions = await Transaction.find().sort({ createdAt: -1 });
    
    // Calculate total spent
    const totalSpent = transactions.reduce((acc, t) => acc + (t.totalAmount || 0), 0);

    // Calculate category breakdown for Charts/Summary
    const categoryTotals = {};
    transactions.forEach(t => {
      const cat = t.category || 'Other';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (t.totalAmount || 0);
    });

    res.render('index', { transactions, totalSpent, categoryTotals });
  } catch (err) {
    console.error(err);
    res.status(500).send("Server Error");
  }
});

// 2. Render Upload Page
app.get('/add', (req, res) => {
  res.render('add');
});

// 3. Handle Receipt Upload & AI Extraction
app.post('/add', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('Please upload an image file.');
    }

    const filePath = req.file.path;
    const mimeType = req.file.mimetype;

    // Call Gemini Model
    const model ="gemini-3.5-flash";
    const prompt = `
      Analyze this receipt/invoice image. Extract the following details and return ONLY a clean JSON object (no markdown backticks):
      {
        "vendorName": "Store or merchant name",
        "date": "YYYY-MM-DD",
        "totalAmount": 0.00,
        "category": "Choose one: Food, Shopping, Bills, Travel, Other"
      }
    `;

    const imagePart = fileToGenerativePart(filePath, mimeType);
    const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: [
        {
            role: "user",
            parts: [
                { text: prompt },
                { inlineData: imagePart.inlineData }
            ]
        }
    ]
});

const responseText = response.text.trim();
    
    const cleanJson = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const data = JSON.parse(cleanJson);

    // Save to MongoDB
    await Transaction.create({
      vendorName: data.vendorName || 'Unknown',
      date: data.date || new Date().toISOString().split('T')[0],
      totalAmount: Number(data.totalAmount) || 0,
      category: data.category || 'Other',
      imagePath: '/uploads/' + req.file.filename
    });

    res.redirect('/');
  } 
  catch (error) {
  console.error('EXACT AI ERROR:', error);
  res.status(500).send('Failed to process receipt with AI: ' + error.message);
}
});

// Real-Time Budget Check Route
app.get('/api/budget-status', async (req, res) => {
    try {
        const totalSpentResult = await Transaction.aggregate([
            { $group: { _id: null, total: { $sum: "$totalAmount" } } }
        ]);
        const totalSpent = totalSpentResult[0]?.total || 0;

       let budget = await Budget.findOneAndUpdate(
    { userId: 'default_user' },
    { monthlyLimit: 1200 },
    { new: true, upsert: true }
);

        const percentage = (totalSpent / budget.monthlyLimit) * 100;
        let alertMessage = null;
        let alertType = 'safe';

        if (totalSpent >= budget.monthlyLimit) {
            alertMessage = "You have exceeded your limit";
            alertType = 'danger';
        } else if (percentage >= 80) {
            alertMessage = " Warning: you have used your 80% of your limit.";
            alertType = 'warning';
        }

        res.json({ totalSpent, monthlyLimit: budget.monthlyLimit, percentage, alertMessage, alertType });
    } catch (err) {
        console.error("Budget Error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});
// Delete Transaction Route
app.get('/delete/:id', async (req, res) => {
    try {
        await Transaction.findByIdAndDelete(req.params.id);
        res.redirect('/');
    } catch (err) {
        console.error("Delete Error:", err);
        res.status(500).send("Error deleting transaction");
    }
});

app.get('/ai-coach', async (req, res) => {
    try {
        const transactions = await Transaction.find({});
        const budgetDoc = await Budget.findOne({});
        const totalSpent = transactions.reduce((acc, curr) => acc + (curr.totalAmount || 0), 0);
        const budgetLimit = budgetDoc ? budgetDoc.monthlyLimit : 10000; // Default limit agar set na ho

        // AI ke liye prompt taiyar karte hain
        const prompt = `You are an expert AI financial coach for a college student using "Smart Budget Guardian". 
        Here is their financial data:
        - Monthly Budget Limit: ₹${budgetLimit}
        - Total Spent So Far: ₹${totalSpent}
        - Recent Transactions: ${JSON.stringify(transactions.map(t => ({ vendor: t.vendorName, amount: t.perPersonShare || t.amount, category: t.category, date: t.date })))}

        Provide 3 concise, actionable, and friendly financial tips in both English and Hindi to help them save money and manage their expenses better. Keep the tone encouraging.`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: prompt,
        });

        const aiAdvice = response.text;

        // EJS template render karo (views/ai-coach.ejs)
        res.render('ai-coach', { aiAdvice, totalSpent, budgetLimit });
    } catch (err) {
        console.error("AI Coach Error:", err);
        res.status(500).send("AI Coach is currently unavailable.");
    }
});

// Get Budget Page
app.get('/budget', async (req, res) => {
    try {
        let budget = await Budget.findOne({ userId: 'default_user' });
        if (!budget) {
            budget = await Budget.create({ userId: 'default_user' });
        }
        res.render('budget', { budget });
    } catch (error) {
        res.status(500).send("Error fetching budget");
    }
});

// Update Student Campus Budget
app.post('/budget/update', async (req, res) => {
    try {
        const { monthlyLimit, foodCanteen, rentHostel, booksSupplies, travelCommute, outingFun } = req.body;
        
        await Budget.findOneAndUpdate(
            { userId: 'default_user' },
            {
                monthlyLimit,
                categoryLimits: {
                    foodCanteen,
                    rentHostel,
                    booksSupplies,
                    travelCommute,
                    outingFun
                }
            },
            { upsert: true, returnDocument: 'after' }
        );
        res.redirect('/budget');
    } catch (error) {
        res.status(500).send("Error updating budget");
    }
});


app.post('/add-transaction', async (req, res) => {
    try {
        const { title, amount, category, date } = req.body;
        const parsedAmount = parseFloat(amount);

        // 1. Accuracy Check: Invalid or Negative Amount
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            await ErrorLog.create({
                failedInput: req.body,
                errorMessage: "Validation Error: Amount must be greater than zero."
            });
            return res.status(400).send("❌ Accuracy Guard: Invalid amount detected and logged.");
        }

        // 2. Accuracy Check: Duplicate / Double-Scan Protection
        const existingTransaction = await Transaction.findOne({ 
            title: title.trim(), 
            amount: parsedAmount, 
            date 
        });

        if (existingTransaction) {
            await ErrorLog.create({
                failedInput: req.body,
                errorMessage: "Duplicate Entry Error: Identical transaction scanned twice."
            });
            return res.status(400).send("⚠️ Accuracy Guard: Duplicate transaction prevented and cached!");
        }

        // Safe & Verified Entry
        await Transaction.create({
            title: title.trim(),
            amount: parsedAmount,
            category,
            date: date || new Date()
        });

        res.redirect('/');
    } catch (error) {
        // Cache unexpected errors securely to protect system state
        await ErrorLog.create({
            failedInput: req.body,
            errorMessage: error.message
        });
        res.status(500).send("Server error during accuracy check.");
    }
});
// Get Split Bills Page
app.get('/split', async (req, res) => {
    try {
        const bills = await SplitBill.find({ userId: 'default_user' }).lean();
        res.render('split', { bills });
    } catch (error) {
        res.status(500).send("Error loading split bills");
    }
});

// Add Split Bill

app.post('/split/add', async (req, res) => {
    try {
        const { title, totalAmount, paidBy, participants } = req.body;
        const participantArray = participants.split(',').map(p => p.trim()).filter(Boolean);
        const perPerson = parseFloat(totalAmount) / (participantArray.length || 1);

        // 1. SplitBill create karo
        await SplitBill.create({
            title,
            totalAmount: parseFloat(totalAmount),
            paidBy,
            participants: participantArray,
            perPersonShare: perPerson
        });

        // 2. Ise Transaction model me bhi save kar do taaki Total Expenses me jud jaye
       // 2. Transaction model me sahi field names ke sath save karo
       // 2. Transaction model me save karo
        await Transaction.create({
            vendorName: `Split: ${title} (Paid by ${paidBy})`,
            totalAmount: perPerson,
            category: 'Food'
        });

        res.redirect('/split');
    } catch (error) {
      console.error("Error in split add:",error);
        res.status(500).send("Error adding split bill");
    }
});


i18n.configure({
    locales: ['en', 'hi'],
    directory: __dirname + '/locales',
    defaultLocale: 'en',
    cookie: 'lang_code',
    objectNotation: true
});

// Middleware setup (express.urlencoded ke baad likhein)
app.use(i18n.init);

// Language switcher route (Jisse user bhasha badal sake)
app.get('/change-lang/:lang', (req, res) => {
    res.cookie('lang_code', req.params.lang);
    res.redirect('back');
});
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;
        
        // 1. Database se saari transactions aur budget nikaalein
        const transactions = await Transaction.find().lean();
        const budgetDoc = await Budget.findOne({ userId: 'default_user' });
        
        const totalSpent = transactions.reduce((acc, t) => acc + (t.totalAmount || 0), 0);
        const budgetLimit = budgetDoc ? budgetDoc.monthlyLimit : 10000;

        // 2. AI ke liye ek smart prompt banayein jisme project ka sara data ho
        const prompt = `
        You are an expert AI financial coach for the user's SmartSpend AI project. 
        Here is the user's current project financial data:
        - Monthly Budget Limit: ₹${budgetLimit}
        - Total Spent So Far: ₹${totalSpent}
        - All Transactions History: ${JSON.stringify(transactions)}

        Answer the user's question concisely, helpfully, and accurately based on this project data in English or Hindi as asked: ${message}
        `;

        // 3. Gemini Model ko call karein
        const response = await ai.models.generateContent({
            model: "gemini-3.5-flash", // ya gemini-2.0-flash
            contents: [{ role: "user", parts: [{ text: prompt }] }]
        });

        const reply = response.text || "Main aapki kya madad kar sakta hoon?";
        res.json({ reply });
        
    } catch (error) {
        console.error("Chat Error:", error);
        res.status(500).json({ error: "Chatbot is currently unavailable." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));