//  Utilities to merge in later with gulp or webpack
// const groupBy = function(xs, key) {
//   return xs.reduce(function(rv, x) {
//     (rv[x[key]] = rv[x[key]] || []).push(x)
//     return rv
//   }, {})
// }
//this is for wayfair

function groupByArray(xs, key) {
    return xs.reduce(function (rv, x) {
        let v = x[key];
        let el = rv.find((r) => r && r.key === v);
        if (el) {
          el.values.push(x);
        } else {
          rv.push({ key: v, values: [x] });
        }
        return rv;
      }, []);
  }
  
  /**
   *
   * @param errObj
   * @returns {boolean}
   */
  function isIIOErrorObject(errObj) {
    return (errObj.hasOwnProperty('code') && errObj.hasOwnProperty('message') && errObj.hasOwnProperty('source'))
  }
  
  /**
   * Helper to create an IIO compatible error object
   * @param code
   * @param message
   * @param source
   * @returns {{code, source, message}}
   */
  function makeError(code, message, source) {
    return {
      code: code,
      message: message,
      source: source
    }
  }
  
  /**
   *
   * @param e
   * @returns {{code, source, message}|*}
   */
  function mapError (e) {
    if (isIIOErrorObject(e)) {
      return e
    } else if (e instanceof Error) {
      return makeError(e.name, e.description, SOURCE_SCRIPT)
    } else {
      throw `Caught exception is unsupported type: ${JSON.stringify(e)}`
    }
  }
  
  /**
   * The ID of this script, used for throwing/logging errors
   * @type {string}
   */
  const SOURCE_SCRIPT = 'import_856_preMap.js'
  
  
  /*
  * preMapFunction stub:
  *
  * The name of the function can be changed to anything you like.
  *
  * The function will be passed one ‘options’ argument that has the following fields:
  *   ‘data’ - an array of records representing the page of data before it has been mapped.  A record can be an object {} or array [] depending on the data source.
  *   '_importId' - the _importId currently running.
  *   '_connectionId' - the _connectionId currently running.
  *   '_flowId' - the _flowId currently running.
  *   '_integrationId' - the _integrationId currently running.
  *   'settings' - all custom settings in scope for the import currently running.
  *
  * The function needs to return an array, and the length MUST match the options.data array length.
  * Each element in the array represents the actions that should be taken on the record at that index.
  * Each element in the array should have the following fields:
  *   'data' - the modified/unmodified record that should be passed along for processing.
  *   'errors' -  used to report one or more errors for the specific record.  Each error must have the following structure: {code: '', message: '', source: ‘’ }
  * Returning an empty object {} for a specific record will indicate that the record should be ignored.
  * Returning both 'data' and 'errors' for a specific record will indicate that the record should be processed but errors should also be logged.
  * Throwing an exception will fail the entire page of records.
  */
  function preMap (options) {
    console.debug(`Source data record count: ${options.data.length}`)
  
    const mapped = options.data.map((record) => {
  
      // buffer for errors encountered while mapping a record
      const errors = []
  
      //  Catch any exceptions but don't return the failed mapped record
      try {
        //  Sum the carton weight to get the total shipment weight
        record.shipmentWeight = record.cartonData.reduce((acc, val) => {
          return acc + Number(val.weight_lbs)
        }, 0)
  
        //  While we could use handlebars to access the length property, it's safer to explicitly store it in case the
        //  underlying data model is changed and the template isn't updated.
        record.shipmentCount = record.cartonData.length
  
        //  I've been pouring over 856 specification docs and have a much better understanding of the format now. This is
        //  not trivial. Shipment has 1+ orders, orders have 1+ PACKages, PACKages have 1+ items.
        //  The CartonData collection will drive the "Pack" HL loop. Handlebars doesn't support user defined variables so
        //  we can't handle HL reference values in the template, instead we'll need to handle that here in script.
        //
        //  The plan is that we'll build up the CartonData collection with Item Details as well. We'll also assign the HL
        //  number to each carton and also to it's item records
        //  Map the CartonData and add the Items and set HL values (parent and level)
        //
        //  Note: The data we're working with for cartons will have multiple records for a single physical carton if there
        //        are more than one item in the carton. This means we need to group the records by tracking number (?)
        const groupedCartons = groupByArray(record.cartonData, 'tracking_number')
        console.debug('grouped cartons source data: ' + JSON.stringify(groupedCartons))
  
        let HLID = 3 // Shipment is 1, order (only 1) is 2 which means the first carton is 3
        let totalLineItems = 0
  
        //  Map the grouped carton data into hierarchical structure with items per carton structure
        record.cartons = groupedCartons.map(carton => {
          carton.items = []
  
          let packHLId = HLID
          return {
            hlID: HLID++,
            hlParentID: 2,
            sscc: carton.values[0].sscc,
            trackingNumber: carton.values[0].tracking_number,
            items: carton.values.map(item => {
              console.log(` item: ${JSON.stringify(item)}`)
              console.log(` orderData: ${JSON.stringify(record.orderData)}`)
              totalLineItems++
              const orderLineData = record.orderData.find(x => x.item_iid == item.item_iid)
               console.log(`----------------------------`)
                console.log(record.orderData.line_item_iid)
              if (!orderLineData) {
                throw makeError('MISSING_REQUIRED_DATA',
                  `Failed to find matching line in orderData for line ${item.transaction_line_id}`, SOURCE_SCRIPT)
              }
  
              return {
                hlID: HLID++,
                hlParentID: packHLId,
                shippedQuantity: item.shipped_quantity,
                //assignedID: item.transaction_line_id,
                 assignedID: orderLineData.edi_line_assigned_id,
                 ean:orderLineData.ym_ean,
                uom: 'EA',  // In the future we may need to source this from the search data out of NS
                buyersPartNumber: orderLineData.buyers_part_number,
                supplierSKU: orderLineData.supplier_sku,
                buyersku: orderLineData.buyer_sku
              }
            })
          }
        })
  
        record.totalLineItems = totalLineItems
        console.debug('mapped record', JSON.stringify(record))
  
      } catch (e) {
        errors.push(e)
        console.error(`Unexpected Error mapping fulfillment ${record.fulfillmentIID}`, JSON.stringify(e))
  
        record = {} //  Indicates the record should be skipped by IIO
      }
  
      return {
        data: record,
        errors: errors.map(e => {
          return mapError(e)
        })
      } 
    })
  
    console.debug(`Mapped data record count: ${mapped.length}`)
    console.info(`Mapping of ${options.data.length} fulfillment complete`)
  
    //  Return the mapped data and any errors
    return mapped
  }