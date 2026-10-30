const mongoose = require('mongoose');

const budgetSchema = new mongoose.Schema({
    userId: { type: String, default: 'default_user' },
    monthlyLimit: { type: Number, required: true, default: 1500 },
    categoryLimits: {
        foodCanteen: { type: Number, default: 3000 },
        rentHostel: { type: Number, default: 3000 },
        booksSupplies: { type: Number, default: 1000 },
        travelCommute: { type: Number, default: 500 },
        outingFun: { type: Number, default: 500 }
    }
}, { timestamps: true });

module.exports = mongoose.model('Budget', budgetSchema);