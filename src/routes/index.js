'use strict'

module.exports = async function (fastify, opts) {

    // Custom handler for async /unitofwork API that synchronously responds to request
    const unitOfWorkResponseHandler = async (request, reply) => {
        reply.code(201).send({'Code201': 'Received!', responseCode: 201});
    }

   /**
    * Asynchronous API that interacts with invoking org via External Service
    * callbacks defined in the OpenAPI spec.
    *
    * The API receives a payload containing Account, Contact, and Case
    * details and uses the unit of work pattern to assign the corresponding
    * values to its Record while maintaining the relationships. It then
    * commits the Unit of Work and returns the Record Id's for each object.
    *
    * The SDKs unit of work API is wrapped around Salesforce's Composite Graph API.
    * For more information on Composite Graph API, see:
    * https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_composite_graph_introduction.htm
    *
    * The unitofworkResponseHandler function provides custom handling to sync'ly respond to the request.
    */
    fastify.post('/unitofwork',
        // async=true to apply standard response 201 response or provide custom response handler function
        {config: {salesforce: {async: unitOfWorkResponseHandler}}},
        async (request, reply) => {
            const { event, context, logger } = request.sdk;
            const org = context.org;
            const dataApi = context.org.dataApi;
            
            logger.info(`POST /unitofwork ${JSON.stringify(event.data || {})}`);

            const validateField = (field, value) => {
                if (!value) throw new Error(`Please provide ${field}`);
            }

            // Validate Input
            const data = event.data;
            validateField('accountName', data.accountName);
            validateField('id', data.id);
            validateField('lastName', data.lastName);
            validateField('subject', data.subject);

            /** Generating PDF for the Account Details page */
            const puppeteer = require('puppeteer'); //requiring puppeteer
          
            const browser = await puppeteer.launch({ headless: true }); //launching puppeteer 
            const page = await browser.newPage(); // lauching a new browser page


            await page.goto('test.salesforce.com'+data.id);
            const pdfBuffer = await page.pdf({
                format: 'A4',
                printBackground: true
              });
          
              await browser.close();

              reply.type('application/pdf');
              

            // Create a unit of work that inserts multiple objects.
            const uow = dataApi.newUnitOfWork();

            // Register a new Account for Creation
            const accountId = uow.registerCreate({
                type: 'Account',
                fields: {
                    Name: data.accountName
                }
            });
            const attachmentId = uow.registerCreate({
                type: 'attachment',
                fields: {
                    body: data.Blob.valueOf(reply.send(pdf)),
                    Name: fileName,
                    Body: pdfBuffer.toString('base64'),
                    ContentType: 'application/pdf',
                    ParentId: data.id // Get the ReferenceId from previous operation

                }
            });

            try {
                // Commit the Unit of Work with all the previous registered operations
                const response = await dataApi.commitUnitOfWork(uow);

                // Construct the result by getting the Id from the successful inserts
                const callbackResponseBody = {
                    accountId: response.get(accountId).id,
                    attachmentId: response.get(attachmentId).id,
                };

                const opts = {
                    method: 'POST',
                    body: JSON.stringify(callbackResponseBody),
                    headers: {'Content-Type': 'application/json'}
                }
                const callbackResponse = await org.request(data.callbackUrl, opts);
                logger.info(JSON.stringify(callbackResponse));
            } catch (err) {
                const errorMessage = `Failed to insert record. Root Cause : ${err.message}`;
                logger.error(errorMessage);
                throw new Error(errorMessage);
            }
            return reply;
    });

    

    fastify.setErrorHandler(function (error, request, reply) {
        request.log.error(error)
        reply.status(500).send({ code: '500', message: error.message });
    });
}
