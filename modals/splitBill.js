const mongoose = require('mongoose');

const splitBillSchema = new mongoose.Schema({
    userId: { type: String, default: 'default_user' },
    title: { type: String, required: true },
    totalAmount: { type: Number, required: true },
    paidBy: { type: String, required: true },
    participants: [{ type: String }], // e.g., ['Rohan', 'Amit', 'Rahul']
    perPersonShare: { type: Number },
    status: { type: String, default: 'Pending' }
}, { timestamps: true });

module.exports = mongoose.model('SplitBill', splitBillSchema);