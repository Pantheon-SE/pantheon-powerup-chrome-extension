const pantheon = require('./pantheon');
const $ = require('jquery');
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
pdfMake.vfs = pdfFonts.pdfMake.vfs;
require('datatables.net-bs4')(window, $);
require('datatables.net-buttons-bs4')(window, $);
require('datatables.net-buttons/js/buttons.html5.js')(window, $);
require('datatables.net-responsive')(window, $);
require('datatables.net-bs4/css/dataTables.bootstrap4.css');
import moment from 'moment';
import secTemplate from '../template/security.html';
import crel from 'crel';
const Table = require('table-builder');
import _ from 'lodash';

/**
 * quicksilver_post_tasks
 * quicksilver_pre_tasks
 */
export class SiteWorkflows {
  constructor(siteId) {
    this.siteId = siteId;
    this.url = `/api/sites/${this.siteId}/workflows?hydrate=operations_with_logs`;
    this.env = this.getEnv();
    window.workflows = window.workflows || {};
  }

  /**
   * Get current env
   * @returns string
   */
  getEnv() {
    return window.location.hash.substring(1).split('/')[0];
  }

  /**
   * Prepare log area.
   */
  prepareArea(regionSelector) {
    var template = document.createElement('template');
    template.innerHTML = secTemplate;
    regionSelector.append(template.content);
  }

  /**
   * Add workflows to region
   */
  async addWorkflows() {
    await this.getWorkflowLogs().then(async () => {
      const types = {
        quicksilver: '#quicksilver-table-region',
        workflow: '#workflow-table-region',
      };

      for (let i in types) {
        const tableSelector = types[i];
        if (i == 'quicksilver') {
          this.attachQuicksilverWorkflows(tableSelector);
        }
        if (i == 'workflow') {
          await this.attachWorkflows(tableSelector);
        }
      }
    });
  }

  /**
   * Wrapper to fetch logs.
   */
  async getWorkflowLogs() {
    if (window?.workflows !== undefined) {
      window.workflows['all'] = await fetch(this.url)
        .then(
          (response) => response.json(),
          (err) => {
            console.error(err);
          },
        )
        .then((data) => {
          return this.processWorkflowData(data);
        });
    }

    // Filter by env
    window.workflows[this.env] = this.filterEnvLogs(window.workflows.all);
    return window.workflows[this.env];
  }

  /**
   * Add specific keys for readability.
   * @param {array} data
   */
  processWorkflowData(data) {
    for (let i = 0; i < data.length; i++) {
      let op = data[i];

      op['wf_type_name'] = pantheon.getWorkflowName(op.type);
      op['wf_user'] = 'Pantheon';
      op['wf_runtime'] = String(op.run_time.toFixed(2)) + 's';

      // Get readable date
      let wfDate = moment(op.started_at * 1000).local();
      op['wf_date'] = wfDate.format('YYYY-MM-DD HH:mm:ss');

      let wfUser = pantheon.getMembershipUsers(op.user_id);
      if (wfUser !== null) {
        op['wf_user'] = wfUser.profile.attributes.full_name;
      }
    }
    return data;
  }

  /**
   * Filter logs by env.
   */
  filterEnvLogs(logs) {
    return logs.filter((log) => log?.environment_id == this.env);
  }

  /**
   * Attach workflow log table.
   * @param {array} workflows
   */
  async attachWorkflows(selector) {
    const workflows = await this.getWorkflowLogs();
    const region = document.querySelector(selector);
    region.innerHTML = '';
    if (workflows?.length && workflows.length > 0) {
      const headers = {
        wf_date: 'Date',
        wf_type_name: 'Workflow',
        environment: 'Environment',
        description: 'Description',
        result: 'Result',
        wf_runtime: 'Runtime',
        wf_user: 'User',
      };
      const tableSelector = selector.replace('#', '') + '-table';
      const table = this.buildTable(workflows, headers, tableSelector);
      region.innerHTML = table;
      $('#' + tableSelector).DataTable({
        dom: 'Bfrtip',
        buttons: ['copyHtml5', 'csvHtml5', 'pdfHtml5'],
      });
    } else {
      region.append(
        crel('p', { class: 'text-center well' }, 'No logs available.'),
      );
    }
  }

  /**
   * Attach Quicksilver logs
   */
  attachQuicksilverWorkflows(selector) {
    const workflows = this.filterQuicksilverLogs();
    const region = document.querySelector(selector);
    const formatRow = this.formatRow;
    region.innerHTML = '';
    if (workflows?.length && workflows.length > 0) {
      // Prepate table data.
      const headers = {
        control: 'dt-control',
        wf_date: 'Date',
        wf_type_name: 'Workflow',
        environment: 'Environment',
        description: 'Description',
        result: 'Result',
        wf_runtime: 'Runtime',
        wf_user: 'User',
      };

      const tableSelector = selector.replace('#', '') + '-table';
      const tableId = '#' + tableSelector;
      // const table = this.buildTable(workflows, headers, tableSelector);
      region.innerHTML = this.tempDataTable(headers, workflows, tableSelector);
      const dtHeaders = (headers) => {
        let temp = [];
        let th = {};
        for (const h in headers) {
          if (h == 'control') {
            th = {
              className: 'dt-control',
              orderable: false,
              data: null,
              defaultContent: '',
            };
          } else {
            th = { data: h };
          }
          temp.push(th);
        }
        return temp;
      };
      const table = $(tableId).DataTable({
        dom: 'Bfrtip',
        buttons: ['copyHtml5', 'csvHtml5', 'pdfHtml5'],
        columns: dtHeaders(headers),
        order: [[1, 'asc']],
      });

      // Add event listener for opening and closing details
      $(tableId + ' tbody').on('click', 'td.dt-control', function () {
        var tr = $(this).closest('tr');
        var row = table.row(tr);

        if (row.child.isShown()) {
          // This row is already open - close it
          row.child.hide();
          tr.removeClass('shown');
        } else {
          // Open this row
          row.child(formatRow(tr.data('log-output'))).show();
          tr.addClass('shown');
        }
      });
    } else {
      region.append(
        crel('p', { class: 'text-center well' }, 'No logs available.'),
      );
    }
  }

  /**
   * Generate table string
   * @param {*} columns
   * @param {*} id
   * @returns
   */
  tempDataTable(headers, data, id) {
    const generateTh = (columns) => {
      let thString = '';
      for (let i in columns) {
        const val = columns[i];
        if (i == 'control') {
          thString += `<th></th>`;
        } else {
          thString += `<th>${val}</th>`;
        }
      }
      return thString;
    };
    const generateRows = (headers, data) => {
      let rows = '';
      for (const d in data) {
        let row = `<tr data-log-output="${data[d].log_output}"><td class="dt-control"></td>`;
        for (const h in headers) {
          if (h == 'control') {
            continue;
          }
          row += `<td>${data[d][h]}</td>`;
        }
        row += `</tr>`;
        rows += row;
      }
      return rows;
    };

    const table = `<table id="${id}" class="table" style="width:100%">
    <thead><tr>${generateTh(headers)}</tr></thead>
    <tbody>${generateRows(headers, data)}<tbody>
    <tfoot><tr>${generateTh(headers)}</tr></tfoot>
    </table>`;
    return table;
  }

  /**
   * Filter out Quicksilver logs
   */
  filterQuicksilverLogs() {
    const qsKey = `${this.env}_qs`;
    if (!window.workflows[qsKey]) {
      const envLogs = window.workflows[this.env];
      const qsLogs = envLogs.filter(
        (log) =>
          log?.quicksilver_post_tasks !== undefined ||
          log?.quicksilver_pre_tasks !== undefined,
      );

      let quicksilverOperations = [];

      if (qsLogs?.length && qsLogs.length > 0) {
        qsLogs.forEach((workflow) => {
          if (
            workflow.has_operation_log_output &&
            workflow?.operations !== undefined
          ) {
            for (let i = 0; i < workflow.operations.length; i++) {
              let op = workflow.operations[i];
              if (op.type == 'quicksilver') {
                // Add workflow data to operation.
                op['wf_active_description'] = workflow.active_description;
                op['wf_description'] = workflow.description;
                op['wf_environment'] = workflow.environment;
                op['wf_type'] = workflow.type;
                op['wf_type_name'] = pantheon.getWorkflowName(workflow.type);
                op['wf_user_id'] = workflow.user_id;
                op['wf_user'] = 'Pantheon';
                op['wf_runtime'] = String(op.run_time.toFixed(2)) + 's';

                // Get readable date
                let wfDate = moment(workflow.started_at * 1000).local();
                op['wf_date'] = wfDate.format('YYYY-MM-DD HH:mm:ss');

                let wfUser = pantheon.getMembershipUsers(workflow.user_id);
                if (wfUser !== null) {
                  op['wf_user'] = wfUser.profile.attributes.full_name;
                }

                // Get all operations.
                quicksilverOperations.push(op);
              }
            }
          }
        });
      }
      window.workflows[qsKey] = quicksilverOperations;
    }
    return window.workflows[qsKey];
  }

  /**
   * Generate standard HTML table.
   * @param {*} data
   * @param {*} headers
   * @param {string} selector
   * @returns
   */
  buildTable(data, headers, selector) {
    return new Table({ class: 'table', id: selector })
      .setHeaders(headers)
      .setData(data)
      .render();
  }

  /**
   * Format row data
   * @param {*} d
   * @returns
   */
  formatRow(d) {
    // `d` is the original data object for the row
    return (
      '<table cellpadding="5" cellspacing="0" border="0" style="padding-left:50px;">' +
      '<tr>' +
      '<td><pre>' +
      d +
      '</pre></td>' +
      '</tr>' +
      '</table>'
    );
  }

  /**
   *
   * @param {*} data
   * @returns
   */
  generateDataTable(data) {
    const formatRow = this.formatRow;

    let headers = [
      {
        name: 'Date',
        prop: 'wf_date',
      },
      {
        name: 'Workflow',
        prop: 'wf_type_name',
      },
      {
        name: 'Environment',
        prop: 'environment',
      },
      {
        name: 'Description',
        prop: 'description',
      },
      {
        name: 'Result',
        prop: 'result',
      },
      {
        name: 'Runtime',
        prop: 'wf_runtime',
      },
      {
        name: 'User',
        prop: 'wf_user',
      },
    ];

    let columns = [
      {
        className: 'dt-control',
        orderable: false,
        data: null,
        defaultContent: '',
      },
    ];

    let thColumns = [];

    // Prepare data
    headers.forEach((header) => {
      columns.push({ data: header.prop, title: header.name });
      thColumns.push(`<th>${header.name}</th>`);
    });

    console.log('datatable columns', columns);
    console.log('datatable data', data);

    let jqElement = $('<table>');

    let table = jqElement.DataTable({
      data: data,
      columns: columns,
      order: [[1, 'desc']],
    });

    // Add event listener for opening and closing details
    $('tbody', jqElement).on('click', 'td.dt-control', function () {
      let tr = $(this).closest('tr');
      let row = table.row(tr);

      if (row.child.isShown()) {
        // This row is already open - close it
        row.child.hide();
        tr.removeClass('shown');
      } else {
        // Open this row
        row.child(formatRow(row.data())).show();
        tr.addClass('shown');
      }
    });

    return jqElement;
  }
}