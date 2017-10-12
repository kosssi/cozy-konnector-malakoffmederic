const {BaseKonnector, log, request, saveBills} = require('cozy-konnector-libs')
const moment = require('moment')

let rq = request()
const j = rq.jar()
rq = request({
  // debug: true,
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

    return rq({
      method: 'POST',
      url: `${domain}/dwr/call/plaincall/__System.generateId.dwr`,
      body: `callCount=1\nc0-scriptName=__System\nc0-methodName=generateId\nc0-id=0\nbatchId=0\ninstanceId=0\npage=%2FespaceClient%2FLogonAccess.do\nscriptSessionId=\n`
    })
    .then(body => {
      const regexp = /dwr.engine.remote.handleCallback\(.*\)/g
      const matches = body.match(regexp)
      const tokens = matches[0].split('"')
      tokens.pop()
      const scriptSessionId = tokens.pop()

      return scriptSessionId
    })
    .then(scriptSessionId => {
      log('debug', scriptSessionId, 'scriptSessionId')
      let cookie = rq.cookie(`DWRSESSIONID=${scriptSessionId}`)
      j.setCookie(cookie, `${domain}/dwr/call/plaincall/InternauteValidator.checkConnexion.dwr`)
      return rq({
        method: 'POST',
        url: `${domain}/dwr/call/plaincall/InternauteValidator.checkConnexion.dwr`,
        body: `callCount=1\nnextReverseAjaxIndex=0\nc0-scriptName=InternauteValidator\nc0-methodName=checkConnexion\nc0-id=0\nc0-param0=string:${fields.login}\nc0-param1=string:${fields.password}\nc0-param2=string:\nbatchId=1\ninstanceId=0\npage=%2FespaceClient%2FLogonAccess.do\nscriptSessionId=${scriptSessionId}/${tokenify(new Date().getTime())}-${tokenify(Math.random() * 1E16)}\n`
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

    // get the list of reimbursements rows
    $('#tableauxRemboursements > .body > .toggle').each(function () {
      const $header = $(this).find('.headerRemboursements')

      const amount = convertAmount($header.find('.montant').text())
      const date = moment($header.find('#datePaiement').val(), 'x')
      const isThirdPartyPayer = $(this).find('.dateEmission').text().indexOf('professionnels de santé') !== -1

      // unique id for reimbursement
      const idReimbursement = $header.find('#idDecompte').val()

      let fileurl = $header.find('#tbsRembExportPdf').attr('href')
      fileurl = `${domain}${fileurl}`

      const $subrows = $(this).find('> .body tbody tr')
      let beneficiary = null
      $subrows.each(function () {
        const data = $(this).find('td, th').map(function (index, elem) {
          return $(this).text().trim()
        }).get()

        if (data.length === 1) {
          // we have a beneficiary line
          beneficiary = data[0]
        } else {
          // a normal line with data
          const originalAmount = convertAmount(data[data.length - 2])
          const originalDate = moment($(this).find('#datePrestation').val(), 'x').toDate()
          const subtype = data[1]
          // unique id for the prestation line. May be usefull
          const idPrestation = $(this).find('#idPrestation').val()
          const socialSecurityRefund = convertAmount(data[3])
          result.push({
            type: 'health_costs',
            isThirdPartyPayer,
            subtype,
            vendor: 'Malakoff Mederic',
            date: date.toDate(),
            fileurl,
            filename: getFileName(date, idReimbursement),
            requestOptions: {
              jar: j
            },
            amount,
            idReimbursement,
            idPrestation,
            beneficiary,
            socialSecurityRefund,
            originalAmount,
            originalDate,
            isRefund: true
          })
        }
      })
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

function convertAmount (amount) {
  amount = amount.replace(' €', '').replace(',', '.')
  return parseFloat(amount)
}

function tokenify (number) {
  var tokenbuf = []
  var charmap = '1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ*$'
  var remainder = number
  while (remainder > 0) {
    tokenbuf.push(charmap.charAt(remainder & 0x3F))
    remainder = Math.floor(remainder / 64)
  }
  return tokenbuf.join('')
}
