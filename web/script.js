document.addEventListener('DOMContentLoaded', () => {
    const amountDisplay = document.getElementById('amountDisplay');
    const numberPad = document.getElementById('numberPad');
    const doneButton = document.getElementById('doneButton');
    const statusBar = document.getElementById('statusBar');

    let currentAmount = '';
    let nfcTransactionActive = false;
    const MAX_AMOUNT_DIGITS = 6; // e.g., 9999.99 or 999999 if no decimal

    function updateDisplay() {
        if (currentAmount === '' || parseFloat(currentAmount) === 0) {
            amountDisplay.textContent = '$0.00';
        } else {
            // Format as currency (e.g., 1234.56)
            // Assuming 2 decimal places for amounts like 12.34
            let num = parseFloat(currentAmount);
            if (currentAmount.includes('.')) {
                 // Handle cases like "12." or "12.3"
                let parts = currentAmount.split('.');
                let integerPart = parts[0] || '0';
                let decimalPart = parts[1] || '';
                decimalPart = decimalPart.padEnd(2, '0');
                if (decimalPart.length > 2) decimalPart = decimalPart.substring(0,2);
                amountDisplay.textContent = `$${integerPart}.${decimalPart}`;
            } else {
                amountDisplay.textContent = `$${currentAmount}.00`;
            }
        }
        doneButton.disabled = currentAmount === '' || parseFloat(currentAmount) === 0 || nfcTransactionActive;
    }

    function setStatus(message, isError = false) {
        statusBar.textContent = message;
        if (isError) {
            statusBar.classList.add('error');
        } else {
            statusBar.classList.remove('error');
        }
    }

    numberPad.addEventListener('click', (event) => {
        if (nfcTransactionActive || !event.target.matches('button')) return;

        const value = event.target.dataset.value;

        if (value === 'backspace') {
            currentAmount = currentAmount.slice(0, -1);
        } else if (value === '.') {
            if (!currentAmount.includes('.') && currentAmount.length > 0 && currentAmount.length < MAX_AMOUNT_DIGITS -2) {
                currentAmount += '.';
            }
        } else { // Number
            if (currentAmount.includes('.')) {
                let parts = currentAmount.split('.');
                if (parts[1].length < 2 && currentAmount.length < MAX_AMOUNT_DIGITS) {
                    currentAmount += value;
                }
            } else {
                if (currentAmount.length < MAX_AMOUNT_DIGITS - 3) { // Allow space for .00
                    currentAmount += value;
                }
            }
        }
        updateDisplay();
    });

    doneButton.addEventListener('click', async () => {
        if (currentAmount === '' || parseFloat(currentAmount) === 0 || nfcTransactionActive) return;

        const amountToSend = parseFloat(currentAmount);
        console.log(`Amount to charge: $${amountToSend.toFixed(2)}`);

        nfcTransactionActive = true;
        doneButton.disabled = true;
        // Hide number pad, or disable it visually
        // numberPad.classList.add('hidden'); 

        setStatus('Tap phone now...');

        // Simulate backend communication and NFC process
        try {
            // This is where you would send the amount to the backend
            // For now, we'll simulate the flow and potential errors
            // await triggerNFCProcess(amountToSend);
            console.log('Simulating NFC tap initiation with backend...');
            // Example: Simulate a successful tap after 3 seconds
            await new Promise(resolve => setTimeout(resolve, 3000));
            // Check a simulated condition for "Phone moved too quickly"
            if (Math.random() < 0.3) { // Simulate a 30% chance of this error
                throw new Error('PHONE_MOVED_TOO_QUICKLY');
            }
            setStatus(`Payment of $${amountToSend.toFixed(2)} successful!`);
            console.log('NFC Transaction successful (simulated)');
            // After success, reset for a new transaction after a delay
            setTimeout(resetForNewTransaction, 3000);
        } catch (error) {
            console.error('NFC Error (simulated):', error.message);
            if (error.message === 'PHONE_MOVED_TOO_QUICKLY') {
                setStatus('Phone moved too quickly. Please tap again.', true);
                // Re-enable for another tap, keeping amount and state
                nfcTransactionActive = false; // Allow re-enabling tap
                doneButton.disabled = false; // Should likely stay disabled until tap
                // Or, better: backend signals it's ready for tap again
                // For now, just reset status to allow user to retry tapping mentally
                // In a real app, the NFC reader would be re-engaged by the backend
                 setTimeout(() => {
                    setStatus('Tap phone now...');
                    nfcTransactionActive = true; // Re-arm for next (simulated) tap
                }, 2000);
            } else {
                setStatus('Payment failed. Please try again.', true);
                resetForNewTransaction();
            }
        }
    });

    function resetForNewTransaction() {
        currentAmount = '';
        nfcTransactionActive = false;
        // numberPad.classList.remove('hidden');
        setStatus('Enter amount');
        updateDisplay();
    }

    // Initial setup
    setStatus('Enter amount');
    updateDisplay();
}); 