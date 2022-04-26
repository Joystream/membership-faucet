const sendgrid = require('@sendgrid/mail')

import { error, log } from './debug'

const api_key = process.env.SENDGRID_API_KEY
const alert_email = process.env.ALERT_EMAIL

export const sendEmailAlert = (message: string) => {
    if (!api_key || !alert_email) {
        log('Email Alerts not configured, not sending email alert.')
        return
    }

    sendgrid.setApiKey(api_key)

    const msg = {
        to: alert_email,
        from: 'mokhtar@jsgenesis.com',
        subject: 'Member Faucet Alert',
        text: message,
        html: `<span>${message}</span>`,
    }

    sendgrid.send(msg)
        .then(() => {
            log('Sent Email Alert!')
        })
        .catch((err: any) => {
            error('Failed Sending Email Alert', err)
        })
}

export const send_test_alert = () => {
    return sendEmailAlert('test alert message')
}
