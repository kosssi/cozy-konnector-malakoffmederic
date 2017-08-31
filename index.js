const {BaseKonnector, log, request, saveBills} = require('cozy-konnector-libs')
const moment = require('moment')

let rq = request()
const j = rq.jar()
rq = request({
  jar: j,
  json: false
})

module.exports = new BaseKonnector(function fetch (fields) {
  const domain = 'https://extranet.malakoffmederic.com'
  return rq({
    url: `${domain}/espaceClient/LogonAccess.do`,
    resolveWithFullResponse: true
  })
  .then(res => {
    // This id is stored in the cookie and used to check the log in
    let httpSessionId = res.headers['set-cookie'][0]
    httpSessionId = httpSessionId.split(';')[0]
    httpSessionId = httpSessionId.split('=')[1]

    log('debug', httpSessionId, 'httpSessionId')

    return rq(`${domain}/dwr/engine.js`)
    .then(body => {
      const regexp = /dwr.engine._origScriptSessionId = "([A-Z0-9]+)"/g
      const matches = body.match(regexp)
      const id = matches[0].split('"')[1]
      // The client must generate 3 random digits
      const scriptSessionId = id + Math.floor(Math.random() * 1000)
      return scriptSessionId
    })
    .then(scriptSessionId => {
      log('debug', scriptSessionId, 'scriptSessionId')
      return rq({
        method: 'POST',
        url: `${domain}/dwr/call/plaincall/InternauteValidator.checkConnexion.dwr`,
        body: `callCount=1\npage=/espaceClient/LogonAccess.do\nhttpSessionId=${httpSessionId}` +
              `\nscriptSessionId=${scriptSessionId}\nc0-scriptName=InternauteValidator\nc0-methodName=checkConnexion` +
              `\nc0-id=0\nc0-param0=boolean:false\nc0-param1=string:${fields.login}\nc0-param2=string:` +
              `${fields.password}\nc0-param3=string:\nbatchId=0\n`
      })
    })
  })
  .then(body => {
    if (body.indexOf('LOGON_KO') > -1) {
      throw new Error('LOGIN_FAILED')
    }
    log('info', 'LOGGED_IN')
  })
  .then(() => {
    rq = request({
      cheerio: true
    })
  })
  .then(() => rq(`${domain}/espaceClient/sante/tbs/redirectionAction.do`))
  .then($ => {
    const result = []
    $('.headerRemboursements').each(function () {
      let amount = $(this).find('.montant').text()
      amount = amount.replace(' €', '').replace(',', '.')
      amount = parseFloat(amount)

      const dateText = $(this).find('.dateEmission').text()
      let date = dateText.split('Emis le ')[1].split('aux')[0]

      let fileurl = $(this).find('#tbsRembExportPdf').attr('href')
      fileurl = `${domain}${fileurl}`

      const idDecompte = $(this).find('#idDecompte').val()

      date = moment(date, 'DD/MM/YYYY')
      const bill = {
        date: date.toDate(),
        amount,
        fileurl,
        filename: getFileName(date, idDecompte),
        requestOptions: {
          jar: j
        }
      }

      if (bill.amount != null) {
        result.push(bill)
      }
    })
    return result
  })
  .then(entries => saveBills(entries, fields.folderPath, {
    timeout: Date.now() + 60 * 1000,
    identifiers: 'Malakoff'
  }))
})

function getFileName (date, idDecompte) {
  // you can have multiple reimbursements for the same day
  return `${date.format('YYYYMMDD')}_${idDecompte}_malakoff_mederic.pdf`
}
