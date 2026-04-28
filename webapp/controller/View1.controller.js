sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat"
], (Controller, JSONModel, MessageToast, MessageBox, DateFormat) => {
    "use strict";

    const BATCH_GROUP = "$auto";

    return Controller.extend("projectmanagement.controller.View1", {
        _customRolesStorageKey: "customRoles",

        _getODataModel: function () {
            const oComp = this.getOwnerComponent();
            // Use getModel() with no args to avoid "sModelName must be a string or omitted" when "" is not accepted
            return oComp.getModel();
        },

        _createEntry: function (oODataModel, sPath, oPayload) {
            // Use 2 args only so mParameters is not mistaken for aSorters (Unsupported sorter: [object Object])
            const oListBinding = oODataModel.bindList(sPath);
            const oContext = oListBinding.create();
            if (oPayload && oContext.setProperty) {
                Object.keys(oPayload).forEach(function (key) {
                    oContext.setProperty(key, oPayload[key]);
                });
            }
            return oContext;
        },

        _formatDateForOData: function (dateVal) {
            if (!dateVal) return null;
            const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
            if (isNaN(d.getTime())) return null;
            return d.toISOString().slice(0, 10);
        },

        _getPersistedCustomRoles: function () {
            try {
                const aRoles = JSON.parse(localStorage.getItem(this._customRolesStorageKey) || "[]");
                if (!Array.isArray(aRoles)) return [];
                return aRoles
                    .map(function (r) { return (r || "").toString().trim(); })
                    .filter(Boolean);
            } catch (e) {
                return [];
            }
        },

        _savePersistedCustomRoles: function (aRoles) {
            const uniqueRoles = Array.from(new Set(
                (aRoles || [])
                    .map(function (r) { return (r || "").toString().trim(); })
                    .filter(Boolean)
            ));
            localStorage.setItem(this._customRolesStorageKey, JSON.stringify(uniqueRoles));
        },

        _parseDateToUtcMidnightTimestamp: function (dateVal) {
            if (!dateVal) return NaN;

            let d;
            if (dateVal instanceof Date) {
                d = new Date(dateVal.getTime());
            } else if (typeof dateVal === "string") {
                const s = dateVal.trim();
                if (!s) return NaN;

                const ymdMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
                if (ymdMatch) {
                    return Date.UTC(
                        parseInt(ymdMatch[1], 10),
                        parseInt(ymdMatch[2], 10) - 1,
                        parseInt(ymdMatch[3], 10)
                    );
                }
                d = new Date(s);
            } else {
                d = new Date(dateVal);
            }

            if (!d || isNaN(d.getTime())) return NaN;
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
        },

        onInit() {
            const oData = {
                activeTab: "projects",
                availableRoles: [],

                projects: [],
                resources: [],
                allocations: [],

                editingProjectId: null,
                editingResourceId: null,
                newCustomRole: "",
                newProject: { requiredRoles: [] },
                newResource: { roles: [] },
                newAllocation: { projectId: "" },
                newAllocationSlots: [],
                selectedProjectCapacity: 0,

                filters: { projectId: "", resourceId: "" },

                tickets: [],
                newTicket: { date: "", module: "", ticketNo: "", description: "", resourceId: "", onBehalfOfId: "" },

                analytics: {
                    enrichedProjects: [], enrichedResources: [], projectionsByProject: [], projectionsByResource: [], summary: {}
                },

                uiState: {
                    showNewTemplate: false,
                    newTemplateName: "New Custom Template",
                    editingTemplatePath: null,
                    editingTemplateId: null
                },

                templates: [],

                wbsTasks: [],
                wbsTasksForSelectedProject: [],
                wbsSelectedProjectId: "",
                wbsImportTemplateId: "",

                timelineSelectedProjectId: "",
                timelineActiveSection: "tasks",
                timelineData: { tasks: [], weeks: [] },
                timelineResourceData: [],
                employeeSelectedResourceId: "",
                onBehalfOfId: "",
                employeeTasks: [],

                timesheets: [], // actually EDiaryView now
                timesheetsForDisplay: [],
                timesheetFilters: { projectId: "", employeeId: "", taskId: "" },
                timesheetSummary: { totalEntries: 0, totalHours: 0, billableHours: 0, nonBillableHours: 0 },
                newWorkLog: {}
            };

            const oModel = new JSONModel(oData);
            this.getView().setModel(oModel);
            this._loadBackendData();
        },

        _loadBackendData: async function () {
            const oODataModel = this._getODataModel();
            const oViewModel = this.getView().getModel();

            const loadList = async (sPath) => {
                const oListBinding = oODataModel.bindList(sPath);
                const aContexts = await oListBinding.requestContexts();
                return aContexts.map((oCtx) => oCtx.getObject());
            };

            try {
                const [
                    aProjectsRaw,
                    aResourcesRaw,
                    aAllocationsRaw,
                    aProjectRolesRaw,
                    aResourceRolesRaw,
                    aTemplatesRaw,
                    aTemplatePhasesRaw,
                    aTemplateTasksRaw,
                    aWbsTasksRaw,
                    aWorkLogsRaw,
                    aEDiaryViewRaw,
                    aTicketsRaw
                ] = await Promise.all([
                    loadList("/Projects"),
                    loadList("/Resources"),
                    loadList("/Allocations"),
                    loadList("/ProjectRoles"),
                    loadList("/ResourceRoles"),
                    loadList("/Templates"),
                    loadList("/TemplatePhases"),
                    loadList("/TemplateTasks"),
                    loadList("/WBSTasks"),
                    loadList("/WorkLogs"),
                    loadList("/EDiaryView"),
                    loadList("/Tickets").catch(() => [])
                ]);

                const mProjRolesByProject = {};
                aProjectRolesRaw.forEach((pr) => {
                    const sProjId = pr.project_ID;
                    if (!sProjId) {
                        return;
                    }
                    if (!mProjRolesByProject[sProjId]) {
                        mProjRolesByProject[sProjId] = [];
                    }
                    mProjRolesByProject[sProjId].push({
                        role: pr.role,
                        count: pr.count
                    });
                });

                const mResRolesByResource = {};
                aResourceRolesRaw.forEach((rr) => {
                    const sResId = rr.resource_ID;
                    if (!sResId) {
                        return;
                    }
                    if (!mResRolesByResource[sResId]) {
                        mResRolesByResource[sResId] = [];
                    }
                    mResRolesByResource[sResId].push(rr.role);
                });

                // Read the persisted project→template mapping from localStorage
                let mProjectTemplateMap = {};
                try {
                    mProjectTemplateMap = JSON.parse(localStorage.getItem("projectTemplateMap") || "{}");
                } catch (ignore) { }

                const aProjects = aProjectsRaw.map((p) => {
                    return {
                        id: p.ID,
                        name: p.name,
                        budget: Number(p.budget) || 0,
                        startDate: p.startDate,
                        endDate: p.endDate,
                        templateId: mProjectTemplateMap[p.ID] || "",
                        requiredRoles: mProjRolesByProject[p.ID] || []
                    };
                });

                const aResources = aResourcesRaw.map((r) => {
                    return {
                        id: r.ID,
                        name: r.name,
                        type: r.type,
                        salary: Number(r.salary) || 0,
                        officeCost: Number(r.officeCost) || 0,
                        overheadCost: Number(r.overheadCost) || 0,
                        hourlyRate: Number(r.hourlyRate) || 0,
                        roles: mResRolesByResource[r.ID] || []
                    };
                });

                const aAllocations = aAllocationsRaw.map((a) => {
                    return {
                        id: a.ID,
                        projectId: a.project_ID,
                        resourceId: a.resource_ID,
                        role: a.role,
                        hours: a.hours
                    };
                });

                const oRoleSet = new Set();
                aProjectRolesRaw.forEach((pr) => {
                    if (pr.role) {
                        oRoleSet.add(pr.role);
                    }
                });
                aResourceRolesRaw.forEach((rr) => {
                    if (rr.role) {
                        oRoleSet.add(rr.role);
                    }
                });
                this._getPersistedCustomRoles().forEach(function (role) {
                    oRoleSet.add(role);
                });

                // --- Assemble Templates with nested phases and tasks ---
                const mTasksByPhase = {};
                aTemplateTasksRaw.forEach((tt) => {
                    const sPhaseId = tt.phase_ID;
                    if (!sPhaseId) return;
                    if (!mTasksByPhase[sPhaseId]) mTasksByPhase[sPhaseId] = [];
                    mTasksByPhase[sPhaseId].push({
                        id: tt.ID,
                        name: tt.name,
                        role: tt.role,
                        defaultHours: tt.defaultHours,
                        sequence: tt.sequence
                    });
                });

                const mPhasesByTemplate = {};
                aTemplatePhasesRaw.forEach((tp) => {
                    const sTplId = tp.template_ID;
                    if (!sTplId) return;
                    if (!mPhasesByTemplate[sTplId]) mPhasesByTemplate[sTplId] = [];
                    const phaseTasks = (mTasksByPhase[tp.ID] || []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
                    mPhasesByTemplate[sTplId].push({
                        id: tp.ID,
                        name: tp.name,
                        sequence: tp.sequence,
                        tasks: phaseTasks
                    });
                });

                const aTemplates = aTemplatesRaw.map((t) => {
                    const phases = (mPhasesByTemplate[t.ID] || []).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
                    return {
                        id: t.ID,
                        name: t.name,
                        phases: phases
                    };
                });

                // --- Map WBSTasks to local format ---
                const aWbsTasks = aWbsTasksRaw.map((w) => {
                    return {
                        id: w.ID,
                        projectId: w.project_ID,
                        phaseName: w.phaseName,
                        name: w.name,
                        role: w.role,
                        resourceId: w.resource_ID || '',
                        hours: w.hours,
                        startDate: w.startDate,
                        endDate: w.endDate,
                        status: w.status || 'Not Started',
                        sequence: w.sequence,
                        predecessor: w.predecessor_ID || '',
                        reallocatedToId: w.reallocatedTo_ID || ''
                    };
                });

                // --- Map WorkLogs ---
                const aWorkLogs = aWorkLogsRaw.map(wl => ({
                    id: wl.ID,
                    wbs_ID: wl.wbs_ID,
                    employee_ID: wl.employee_ID,
                    date: wl.date,
                    hours: Number(wl.hours) || 0,
                    isBillable: wl.isBillable,
                    nonBillableType: wl.nonBillableType,
                    description: wl.description
                }));

                // --- Map EDiaryView ---
                const aEDiaryView = aEDiaryViewRaw.map(ed => ({
                    id: ed.ID,
                    date: ed.date,
                    hours: Number(ed.hours) || 0,
                    isBillable: ed.isBillable,
                    nonBillableType: ed.nonBillableType,
                    description: ed.description,
                    employeeId: ed.employeeId,
                    employeeName: ed.employeeName,
                    wbsId: ed.wbsId,
                    taskName: ed.taskName,
                    phaseName: ed.phaseName,
                    projectId: ed.projectId,
                    projectName: ed.projectName
                }));

                // Debug: E-Diary fetch/mapping check for Reporting Data table
                console.groupCollapsed("[E-Diary] Fetch + Map Check");
                console.log("Raw /EDiaryView count:", aEDiaryViewRaw.length);
                console.log("Mapped eDiaryView count:", aEDiaryView.length);
                console.table(
                    aEDiaryView.slice(0, 10).map(function (r) {
                        return {
                            id: r.id,
                            date: r.date,
                            employeeName: r.employeeName,
                            projectName: r.projectName,
                            taskName: r.taskName,
                            description: r.description,
                            hours: r.hours,
                            status: r.status,
                            isBillable: r.isBillable,
                            nonBillableType: r.nonBillableType
                        };
                    })
                );
                console.groupEnd();

                // --- Map Tickets ---
                const aTickets = aTicketsRaw.map(t => {
                    const proj = aProjects.find(p => p.id === t.project_ID);
                    const res = aResources.find(r => r.id === t.resource_ID);
                    const onBehalf = aResources.find(r => r.id === t.onBehalfOf_ID);
                    return {
                        id: t.ID,
                        projectId: t.project_ID || '',
                        projectName: proj ? proj.name : '',
                        date: t.date,
                        module: t.module,
                        ticketNo: t.ticketNo,
                        description: t.description,
                        priority: t.priority || 'Medium',
                        resourceId: t.resource_ID || '',
                        resourceName: res ? res.name : '',
                        onBehalfOfId: t.onBehalfOf_ID || '',
                        onBehalfOfName: onBehalf ? onBehalf.name : ''
                    };
                });

                oViewModel.setProperty("/projects", aProjects);
                oViewModel.setProperty("/resources", aResources);
                oViewModel.setProperty("/allocations", aAllocations);
                oViewModel.setProperty("/availableRoles", Array.from(oRoleSet));
                oViewModel.setProperty("/templates", aTemplates);
                oViewModel.setProperty("/wbsTasks", aWbsTasks);
                oViewModel.setProperty("/workLogs", aWorkLogs);
                oViewModel.setProperty("/eDiaryView", aEDiaryView);
                oViewModel.setProperty("/tickets", aTickets);

                this._calculateAnalytics();
                this._computeWbsTasks();
                this._computeTimelineData();
                this._computeTimesheetData(); // This will just format and filter EDiaryView
                if (this.getView().getModel().getProperty("/employeeSelectedResourceId")) {
                    this._computeEmployeeTasks();
                }
            } catch (e) {
                MessageToast.show("Failed to load data from service");
                // eslint-disable-next-line no-console
                console.error("Error loading data from CAP service", e);
            }
        },

        getWorkingHours: function (startStr, endStr) {
            if (!startStr || !endStr) return 0;
            const s = new Date(startStr);
            const e = new Date(endStr);
            if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return 0;
            let count = 0;
            const cur = new Date(s);
            while (cur <= e) {
                const day = cur.getDay();
                if (day !== 0 && day !== 6) count++;
                cur.setDate(cur.getDate() + 1);
            }
            return count * 8;
        },

        _calculateAnalytics: function () {
            const oModel = this.getView().getModel();
            const data = oModel.getData();
            const MAX_HOURS = 2080;

            const enrichedProjects = data.projects.map(p => {
                let actualCost = 0;
                const workingHoursPerResource = this.getWorkingHours(p.startDate, p.endDate);
                const assignedResources = data.allocations
                    .filter(a => a.projectId === p.id && a.resourceId) // Only include actual allocations with a valid resourceId
                    .map(a => {
                        const res = data.resources.find(r => r.id === a.resourceId);
                        if (res) actualCost += a.hours * res.hourlyRate;
                        const weekendHrs = Math.max(0, a.hours - workingHoursPerResource);
                        return { name: res?.name || 'Unknown', role: a.role || 'Unassigned', hours: a.hours, weekendHrs: weekendHrs };
                    });

                const standardCapacity = workingHoursPerResource * (assignedResources.length || 1);
                const template = data.templates.find(t => t.id === p.templateId);
                const templateName = template ? template.name : "None";

                return { ...p, assignedResources, actualCost, standardCapacity, templateName };
            });

            const enrichedResources = data.resources.map(r => {
                const assignedProjects = new Set();
                data.allocations.filter(a => a.resourceId === r.id).forEach(a => {
                    const p = data.projects.find(proj => proj.id === a.projectId);
                    if (p) assignedProjects.add(p.name);
                });
                return { ...r, assignedProjects: Array.from(assignedProjects).join(', ') || 'None' };
            });

            let projectionsByProject = data.projects.map(p => {
                let allocatedCost = 0;
                const activeResources = new Set();
                data.allocations.filter(a => a.projectId === p.id).forEach(alloc => {
                    const res = data.resources.find(r => r.id === alloc.resourceId);
                    if (res) {
                        allocatedCost += alloc.hours * res.hourlyRate;
                        activeResources.add(res.name);
                    }
                });

                // Calculate allocated hours from the Work Breakdown Structure
                const allocatedPlanHours = data.wbsTasks
                    .filter(t => t.projectId === p.id)
                    .reduce((sum, t) => sum + (t.hours || 0), 0);

                const remaining = p.budget - allocatedCost;
                let statusState = "Success";
                if (remaining < 0) statusState = "Error"; else if (remaining < 10000) statusState = "Warning";
                return { ...p, allocatedCost, remaining, resourceCount: activeResources.size, statusState, allocatedPlanHours };
            });

            let projectionsByResource = data.resources.map(r => {
                let totalHours = 0, totalStandardHours = 0, totalWeekendHours = 0;
                const projectNames = new Set();
                const allocationsBreakdown = [];
                let colorIndex = 0;

                data.allocations.filter(a => a.resourceId === r.id).forEach(alloc => {
                    totalHours += alloc.hours;
                    const proj = data.projects.find(p => p.id === alloc.projectId);
                    if (proj) projectNames.add(proj.name);

                    const projCapacity = proj ? this.getWorkingHours(proj.startDate, proj.endDate) : 0;
                    totalStandardHours += Math.min(alloc.hours, projCapacity);
                    totalWeekendHours += Math.max(0, alloc.hours - projCapacity);

                    allocationsBreakdown.push({
                        projectName: proj ? proj.name : 'Unknown',
                        hours: alloc.hours,
                        percentage: ((alloc.hours / MAX_HOURS) * 100) + "%",
                        colorKey: String(colorIndex++ % 4) // <--- CHANGED THIS LINE
                    });
                });

                allocationsBreakdown.forEach(ab => {
                    if (totalHours > MAX_HOURS) ab.percentage = ((ab.hours / totalHours) * 100) + "%";
                });

                // Calculate total task hours from WBS tasks assigned to this resource
                const totalTaskHours = (data.wbsTasks || [])
                    .filter(t => t.resourceId === r.id)
                    .reduce((sum, t) => sum + (t.hours || 0), 0);
                const extraTaskHours = Math.max(0, totalTaskHours - totalHours);

                return {
                    ...r, totalHours, totalStandardHours, totalWeekendHours,
                    totalTaskHours, extraTaskHours,
                    totalBilled: totalHours * r.hourlyRate,
                    projectsAssigned: Array.from(projectNames).join(', ') || 'None',
                    statusText: totalHours > MAX_HOURS ? "Over Occupied" : "Within Capacity",
                    statusState: totalHours > MAX_HOURS ? "Error" : "Success",
                    utilizationPercent: (totalHours / MAX_HOURS) * 100,
                    utilizationDisplay: `${Math.round((totalHours / MAX_HOURS) * 100)}%`,
                    allocationsBreakdown
                };
            });

            const totalBudget = data.projects.reduce((sum, p) => sum + p.budget, 0);
            const totalCost = projectionsByProject.reduce((sum, p) => sum + p.allocatedCost, 0);
            // Sum the total standard hours capacity across all active projects' timelines
            const totalCapacity = enrichedProjects.reduce((sum, p) => sum + (p.standardCapacity || 0), 0);
            // Sum the new allocatedPlanHours (from WBS tasks) across all projects
            const totalAllocatedHours = projectionsByProject.reduce((sum, p) => sum + (p.allocatedPlanHours || 0), 0);

            const summary = {
                totalBudget, totalCost,
                budgetConsumption: totalBudget ? (totalCost / totalBudget) * 100 : 0,
                totalCapacity, totalAllocatedHours,
                hoursUtilization: totalCapacity ? (totalAllocatedHours / totalCapacity) * 100 : 0
            };

            if (data.filters.projectId) {
                projectionsByProject = projectionsByProject.filter(p => p.id === data.filters.projectId);
                projectionsByResource = projectionsByResource.filter(r => data.allocations.some(a => a.resourceId === r.id && a.projectId === data.filters.projectId));
            }
            if (data.filters.resourceId) {
                projectionsByProject = projectionsByProject.filter(p => data.allocations.some(a => a.projectId === p.id && a.resourceId === data.filters.resourceId));
                projectionsByResource = projectionsByResource.filter(r => r.id === data.filters.resourceId);
            }

            oModel.setProperty("/analytics/enrichedProjects", enrichedProjects);
            oModel.setProperty("/analytics/enrichedResources", enrichedResources);
            oModel.setProperty("/analytics/projectionsByProject", projectionsByProject);
            oModel.setProperty("/analytics/projectionsByResource", projectionsByResource);
            oModel.setProperty("/analytics/summary", summary);
        },

        onFilterChange: function () { this._calculateAnalytics(); },
        onClearFilters: function () {
            this.getView().getModel().setProperty("/filters", { projectId: "", resourceId: "" });
            this._calculateAnalytics();
        },

        _openDialog: function (sFragmentName) {
            const oView = this.getView();
            const sPath = "projectmanagement.view.fragments." + sFragmentName;

            if (!this["_p" + sFragmentName]) {
                this["_p" + sFragmentName] = this.loadFragment({ name: sPath }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this["_p" + sFragmentName].then(function (oDialog) { oDialog.open(); });
        },

        onCloseDialog: function (oEvent) { oEvent.getSource().getParent().close(); },

        onAddProject: function () {
            const oModel = this.getView().getModel();
            const aProjects = oModel.getProperty("/projects") || [];
            let maxId = 0;
            aProjects.forEach(p => {
                const sId = (p.id || p.ID || "").toString();
                const numStr = sId.replace(/\D/g, "");
                if (numStr) {
                    const num = parseInt(numStr, 10);
                    if (num > maxId) maxId = num;
                }
            });
            const newId = `P${String(maxId + 1).padStart(3, '0')}`;
            oModel.setProperty("/editingProjectId", null);
            oModel.setProperty("/newProject", { id: newId, name: "", budget: null, startDate: "", endDate: "", requiredRoles: [], templateId: "" });
            this._openDialog("CreateProject");
        },

        onEditProject: function (oEvent) {
            const oItem = oEvent.getSource().getBindingContext().getObject();
            const oModel = this.getView().getModel();
            const itemCopy = JSON.parse(JSON.stringify(oItem));
            // Read templateId from localStorage if not already set on item
            if (!itemCopy.templateId) {
                try {
                    const mMap = JSON.parse(localStorage.getItem("projectTemplateMap") || "{}");
                    itemCopy.templateId = mMap[itemCopy.id] || "";
                } catch (ignore) { }
            }
            // Store original template ID to detect changes on save
            oModel.setProperty("/editingOriginalTemplateId", itemCopy.templateId || "");
            oModel.setProperty("/editingProjectId", itemCopy.id);
            oModel.setProperty("/newProject", itemCopy);
            this._openDialog("CreateProject");
        },

        onAddRoleToProject: function () {
            const roles = this.getView().getModel().getProperty("/newProject/requiredRoles") || [];
            roles.push({ role: "", count: 1 });
            this.getView().getModel().setProperty("/newProject/requiredRoles", roles);
        },

        onDeleteRoleFromProject: function (oEvent) {
            const path = oEvent.getSource().getBindingContext().getPath();
            const idx = parseInt(path.split("/").pop());
            const roles = this.getView().getModel().getProperty("/newProject/requiredRoles");
            roles.splice(idx, 1);
            this.getView().getModel().setProperty("/newProject/requiredRoles", roles);
        },

        onAddCustomRole: function () {
            const oModel = this.getView().getModel();
            const newRole = (oModel.getProperty("/newCustomRole") || "").trim();
            const availableRoles = oModel.getProperty("/availableRoles") || [];
            if (newRole && !availableRoles.includes(newRole)) {
                availableRoles.push(newRole);
                oModel.setProperty("/availableRoles", availableRoles);
                this._savePersistedCustomRoles(availableRoles);
            }
            oModel.setProperty("/newCustomRole", "");
        },

        onSaveProject: async function () {
            const oView = this.getView();
            const oModel = oView.getModel();
            const newProj = oModel.getProperty("/newProject");
            const editId = oModel.getProperty("/editingProjectId");

            if (!newProj.name || !newProj.startDate || !newProj.endDate) {
                MessageToast.show("Please fill required fields");
                return;
            }
            if (!newProj.budget) newProj.budget = 0;

            const oODataModel = this._getODataModel();
            const sProjectId = (newProj.id || "").toString().trim();
            const sPathProject = "/Projects('" + encodeURIComponent(sProjectId) + "')";

            try {
                // Save the template association to localStorage (backend schema has no template_ID on Projects)
                const mProjectTemplateMap = JSON.parse(localStorage.getItem("projectTemplateMap") || "{}");
                if (newProj.templateId) {
                    mProjectTemplateMap[sProjectId] = newProj.templateId;
                } else {
                    delete mProjectTemplateMap[sProjectId];
                }
                localStorage.setItem("projectTemplateMap", JSON.stringify(mProjectTemplateMap));

                if (editId) {
                    const oCtx = oODataModel.bindContext(sPathProject).getBoundContext();
                    oCtx.setProperty("name", newProj.name);
                    oCtx.setProperty("budget", parseFloat(newProj.budget) || 0);
                    oCtx.setProperty("startDate", this._formatDateForOData(newProj.startDate));
                    oCtx.setProperty("endDate", this._formatDateForOData(newProj.endDate));

                    const aExistingRoles = await this._loadProjectRolesForProject(oODataModel, sProjectId);
                    for (const oRoleCtx of aExistingRoles) {
                        if (oRoleCtx.delete) {
                            oRoleCtx.delete(BATCH_GROUP);
                        }
                    }
                    const requiredRoles = (newProj.requiredRoles || []).filter(r => r && r.role);
                    for (const r of requiredRoles) {
                        this._createEntry(oODataModel, "/ProjectRoles", {
                            project_ID: sProjectId,
                            role: r.role || "",
                            count: parseInt(r.count, 10) || 1
                        });
                    }
                } else {
                    this._createEntry(oODataModel, "/Projects", {
                        ID: sProjectId,
                        name: newProj.name,
                        budget: parseFloat(newProj.budget) || 0,
                        startDate: this._formatDateForOData(newProj.startDate),
                        endDate: this._formatDateForOData(newProj.endDate)
                    });
                    const requiredRoles = (newProj.requiredRoles || []).filter(r => r && r.role);
                    for (const r of requiredRoles) {
                        this._createEntry(oODataModel, "/ProjectRoles", {
                            project_ID: sProjectId,
                            role: r.role || "",
                            count: parseInt(r.count, 10) || 1
                        });
                    }
                }

                await oODataModel.submitBatch(BATCH_GROUP);
                this.byId("CreateProjectDialog").close();
                MessageToast.show(editId ? "Project Updated" : "Project Saved");
                await this._loadBackendData();

                // Auto-import template tasks into WBS
                if (!editId && newProj.templateId) {
                    // New project: import template tasks
                    await this._autoImportTemplateToWBS(sProjectId, newProj.templateId, newProj.startDate, false);
                } else if (editId) {
                    // Edit: check if template changed
                    const sOldTemplateId = oModel.getProperty("/editingOriginalTemplateId") || "";
                    const sNewTemplateId = newProj.templateId || "";
                    if (sNewTemplateId !== sOldTemplateId) {
                        // Template changed — delete old WBS tasks and import new ones
                        await this._autoImportTemplateToWBS(sProjectId, sNewTemplateId, newProj.startDate, true);
                    }
                }
            } catch (e) {
                MessageToast.show(editId ? "Failed to update project" : "Failed to create project");
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        _loadProjectRolesForProject: async function (oODataModel, sProjectId) {
            const oListBinding = oODataModel.bindList("/ProjectRoles");
            const aContexts = await oListBinding.requestContexts(0, 500);
            return aContexts.filter(function (oCtx) {
                const o = oCtx.getObject ? oCtx.getObject() : {};
                return o.project_ID === sProjectId;
            });
        },

        // --- Template UI Logic ---
        onAddNewTemplate: function () {
            const oModel = this.getView().getModel();
            oModel.setProperty("/uiState/editingTemplatePath", null);
            oModel.setProperty("/uiState/editingTemplateId", null);
            oModel.setProperty("/uiState/newTemplateName", "New Custom Template");
            oModel.setProperty("/uiState/editingTemplatePhases", []);
            oModel.setProperty("/uiState/showNewTemplate", true);
        },

        onEditTemplate: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            if (!oContext) return;
            const oTemplate = oContext.getObject();
            const sPath = oContext.getPath();

            this.getView().getModel().setProperty("/uiState/editingTemplatePath", sPath);
            this.getView().getModel().setProperty("/uiState/editingTemplateId", oTemplate.id);
            this.getView().getModel().setProperty("/uiState/newTemplateName", oTemplate.name);
            this.getView().getModel().setProperty("/uiState/editingTemplatePhases", JSON.parse(JSON.stringify(oTemplate.phases || [])));
            this.getView().getModel().setProperty("/uiState/showNewTemplate", true);
        },

        onSaveTemplate: async function () {
            const oModel = this.getView().getModel();
            const sName = oModel.getProperty("/uiState/newTemplateName") || "Untitled Template";
            const sEditPath = oModel.getProperty("/uiState/editingTemplatePath");
            const aPhases = oModel.getProperty("/uiState/editingTemplatePhases") || [];
            const oODataModel = this._getODataModel();

            try {
                if (sEditPath) {
                    // --- Editing existing template ---
                    const oTemplate = oModel.getProperty(sEditPath);
                    const sTemplateId = oTemplate.id;

                    // Update template name
                    const oTplCtx = oODataModel.bindContext("/Templates('" + encodeURIComponent(sTemplateId) + "')").getBoundContext();
                    oTplCtx.setProperty("name", sName);

                    // Delete existing phases and tasks
                    const aExistingPhases = await this._loadTemplatePhasesForTemplate(oODataModel, sTemplateId);
                    for (const oPhaseCtx of aExistingPhases) {
                        const phaseObj = oPhaseCtx.getObject ? oPhaseCtx.getObject() : {};
                        // Delete tasks belonging to this phase
                        const aExistingTasks = await this._loadTemplateTasksForPhase(oODataModel, phaseObj.ID);
                        for (const oTaskCtx of aExistingTasks) {
                            if (oTaskCtx.delete) oTaskCtx.delete(BATCH_GROUP);
                        }
                        if (oPhaseCtx.delete) oPhaseCtx.delete(BATCH_GROUP);
                    }

                    // Re-create phases and tasks
                    aPhases.forEach((phase, pIdx) => {
                        const oPhaseCtx = this._createEntry(oODataModel, "/TemplatePhases", {
                            template_ID: sTemplateId,
                            name: phase.name,
                            sequence: pIdx + 1
                        });
                        // We need to submit phases first to get IDs, so we use a simpler approach:
                        // Create tasks referencing phase via a temporary approach
                    });

                    await oODataModel.submitBatch(BATCH_GROUP);

                    // Now load the newly created phases to get their IDs, then create tasks
                    const aNewPhaseCtxs = await this._loadTemplatePhasesForTemplate(oODataModel, sTemplateId);
                    const sortedNewPhases = aNewPhaseCtxs.map(c => c.getObject()).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

                    for (let pIdx = 0; pIdx < aPhases.length && pIdx < sortedNewPhases.length; pIdx++) {
                        const phase = aPhases[pIdx];
                        const backendPhase = sortedNewPhases[pIdx];
                        if (phase.tasks) {
                            phase.tasks.forEach((task, tIdx) => {
                                this._createEntry(oODataModel, "/TemplateTasks", {
                                    phase_ID: backendPhase.ID,
                                    name: task.name,
                                    role: task.role || '',
                                    defaultHours: parseInt(task.defaultHours) || 8,
                                    sequence: tIdx + 1
                                });
                            });
                        }
                    }

                    await oODataModel.submitBatch(BATCH_GROUP);
                    MessageToast.show("Template Updated successfully");
                } else {
                    // --- Creating new template ---
                    const sNewId = "TPL_" + Date.now();
                    this._createEntry(oODataModel, "/Templates", {
                        ID: sNewId,
                        name: sName
                    });
                    await oODataModel.submitBatch(BATCH_GROUP);

                    // Create phases
                    aPhases.forEach((phase, pIdx) => {
                        this._createEntry(oODataModel, "/TemplatePhases", {
                            template_ID: sNewId,
                            name: phase.name,
                            sequence: pIdx + 1
                        });
                    });
                    await oODataModel.submitBatch(BATCH_GROUP);

                    // Load phases to get their IDs, then create tasks
                    const aNewPhaseCtxs = await this._loadTemplatePhasesForTemplate(oODataModel, sNewId);
                    const sortedNewPhases = aNewPhaseCtxs.map(c => c.getObject()).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

                    for (let pIdx = 0; pIdx < aPhases.length && pIdx < sortedNewPhases.length; pIdx++) {
                        const phase = aPhases[pIdx];
                        const backendPhase = sortedNewPhases[pIdx];
                        if (phase.tasks) {
                            phase.tasks.forEach((task, tIdx) => {
                                this._createEntry(oODataModel, "/TemplateTasks", {
                                    phase_ID: backendPhase.ID,
                                    name: task.name,
                                    role: task.role || '',
                                    defaultHours: parseInt(task.defaultHours) || 8,
                                    sequence: tIdx + 1
                                });
                            });
                        }
                    }

                    await oODataModel.submitBatch(BATCH_GROUP);
                    MessageToast.show("Template Saved successfully");
                }

                oModel.setProperty("/uiState/editingTemplatePath", null);
                oModel.setProperty("/uiState/showNewTemplate", false);
                await this._loadBackendData();
            } catch (e) {
                MessageToast.show("Failed to save template");
                console.error("Error saving template", e);
            }
        },

        onDeleteTemplate: function () {
            const oModel = this.getView().getModel();
            const sEditPath = oModel.getProperty("/uiState/editingTemplatePath");
            if (!sEditPath) return;

            const oTemplate = oModel.getProperty(sEditPath);
            if (!oTemplate || !oTemplate.id) return;

            oModel.setProperty("/pendingDeleteTemplateName", oTemplate.name || "this template");

            const oView = this.getView();
            if (!this._pDeleteTemplateConfirmDialog) {
                this._pDeleteTemplateConfirmDialog = this.loadFragment({
                    name: "projectmanagement.view.fragments.DeleteTemplateConfirmation"
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pDeleteTemplateConfirmDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onDeleteTemplateConfirm: async function () {
            if (this._pDeleteTemplateConfirmDialog) {
                this._pDeleteTemplateConfirmDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }

            const oModel = this.getView().getModel();
            const sEditPath = oModel.getProperty("/uiState/editingTemplatePath");
            if (!sEditPath) return;

            const oTemplate = oModel.getProperty(sEditPath);
            if (!oTemplate || !oTemplate.id) return;

            const oODataModel = this._getODataModel();
            const sTemplateId = oTemplate.id;

            try {
                // Delete all tasks and phases belonging to this template
                const aPhaseCtxs = await this._loadTemplatePhasesForTemplate(oODataModel, sTemplateId);
                for (const oPhaseCtx of aPhaseCtxs) {
                    const phaseObj = oPhaseCtx.getObject ? oPhaseCtx.getObject() : {};
                    const aTaskCtxs = await this._loadTemplateTasksForPhase(oODataModel, phaseObj.ID);
                    for (const oTaskCtx of aTaskCtxs) {
                        if (oTaskCtx.delete) oTaskCtx.delete(BATCH_GROUP);
                    }
                    if (oPhaseCtx.delete) oPhaseCtx.delete(BATCH_GROUP);
                }

                // Delete the template itself
                const oTplBinding = oODataModel.bindList("/Templates");
                const aTplCtxs = await oTplBinding.requestContexts(0, 500);
                const oTplCtx = aTplCtxs.find(c => {
                    const o = c.getObject ? c.getObject() : {};
                    return o.ID === sTemplateId;
                });
                if (oTplCtx && oTplCtx.delete) {
                    oTplCtx.delete(BATCH_GROUP);
                }

                await oODataModel.submitBatch(BATCH_GROUP);
                MessageToast.show("Template deleted");
                oModel.setProperty("/uiState/editingTemplatePath", null);
                oModel.setProperty("/uiState/showNewTemplate", false);
                await this._loadBackendData();
            } catch (e) {
                MessageToast.show("Failed to delete template");
                console.error("Error deleting template", e);
            }
        },

        onDeleteTemplateCancel: function () {
            if (this._pDeleteTemplateConfirmDialog) {
                this._pDeleteTemplateConfirmDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        _loadTemplatePhasesForTemplate: async function (oODataModel, sTemplateId) {
            const oListBinding = oODataModel.bindList("/TemplatePhases");
            const aContexts = await oListBinding.requestContexts(0, 500);
            return aContexts.filter(function (oCtx) {
                const o = oCtx.getObject ? oCtx.getObject() : {};
                return o.template_ID === sTemplateId;
            });
        },

        _loadTemplateTasksForPhase: async function (oODataModel, sPhaseId) {
            const oListBinding = oODataModel.bindList("/TemplateTasks");
            const aContexts = await oListBinding.requestContexts(0, 500);
            return aContexts.filter(function (oCtx) {
                const o = oCtx.getObject ? oCtx.getObject() : {};
                return o.phase_ID === sPhaseId;
            });
        },

        onAddTemplatePhase: function () {
            const oModel = this.getView().getModel();
            const aPhases = oModel.getProperty("/uiState/editingTemplatePhases") || [];
            aPhases.push({ id: "ph_" + Date.now(), name: "New Phase", tasks: [] });
            oModel.setProperty("/uiState/editingTemplatePhases", aPhases);
        },

        onRemovePhaseFromTemplate: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const path = oContext.getPath();
            const idx = parseInt(path.split("/").pop());
            const oModel = this.getView().getModel();
            const aPhases = oModel.getProperty("/uiState/editingTemplatePhases");
            aPhases.splice(idx, 1);
            oModel.setProperty("/uiState/editingTemplatePhases", aPhases);
        },

        onAddTaskToPhase: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const path = oContext.getPath();
            const oModel = this.getView().getModel();
            const oPhase = oModel.getProperty(path);
            oPhase.tasks = oPhase.tasks || [];
            oPhase.tasks.push({ id: "tk_" + Date.now(), name: "New Task", role: "", defaultHours: 8 });
            oModel.setProperty(path, oPhase);
        },

        onRemoveTaskFromPhase: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const taskPath = oContext.getPath();
            const parts = taskPath.split("/");
            const taskIdx = parseInt(parts.pop());
            parts.pop(); // remove 'tasks'
            const phasePath = parts.join("/");

            const oModel = this.getView().getModel();
            const oPhase = oModel.getProperty(phasePath);
            oPhase.tasks.splice(taskIdx, 1);
            oModel.setProperty(phasePath, oPhase);
        },

        parseCSV: function (text) {
            const lines = text.split('\n').filter(l => l.trim() !== '');
            if (lines.length < 2) return [];
            const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
            return lines.slice(1).map(line => {
                const values = line.split(',').map(v => v.trim());
                const obj = {};
                headers.forEach((h, i) => obj[h] = values[i] || '');
                return obj;
            });
        },

        handleTemplateImport: function (oEvent) {
            const file = oEvent.getParameter("files")[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const parsedData = this.parseCSV(text);

                if (parsedData.length === 0) {
                    MessageToast.show("CSV is empty or invalid format.");
                    return;
                }

                const phasesMap = new Map();
                parsedData.forEach((row) => {
                    const phaseName = row.phase || 'Imported Phase';
                    const taskName = row.task || row['task name'] || 'Imported Task';
                    const role = row.role || '';
                    const hoursStr = row.hours || row['default hours'] || row['hrs'];
                    const hours = parseInt(hoursStr) || 8;

                    if (!phasesMap.has(phaseName)) {
                        phasesMap.set(phaseName, []);
                    }
                    phasesMap.get(phaseName).push({
                        name: taskName,
                        role: role,
                        defaultHours: hours
                    });
                });

                const oODataModel = this._getODataModel();
                const sNewId = "TPL_" + Date.now();

                try {
                    // Create template
                    this._createEntry(oODataModel, "/Templates", {
                        ID: sNewId,
                        name: file.name.replace('.csv', '') || 'Imported Template'
                    });
                    await oODataModel.submitBatch(BATCH_GROUP);

                    // Create phases
                    const phaseEntries = Array.from(phasesMap.entries());
                    phaseEntries.forEach(([name], pIdx) => {
                        this._createEntry(oODataModel, "/TemplatePhases", {
                            template_ID: sNewId,
                            name: name,
                            sequence: pIdx + 1
                        });
                    });
                    await oODataModel.submitBatch(BATCH_GROUP);

                    // Load phases to get IDs, then create tasks
                    const aNewPhaseCtxs = await this._loadTemplatePhasesForTemplate(oODataModel, sNewId);
                    const sortedPhases = aNewPhaseCtxs.map(c => c.getObject()).sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

                    for (let pIdx = 0; pIdx < phaseEntries.length && pIdx < sortedPhases.length; pIdx++) {
                        const tasks = phaseEntries[pIdx][1];
                        const backendPhase = sortedPhases[pIdx];
                        tasks.forEach((task, tIdx) => {
                            this._createEntry(oODataModel, "/TemplateTasks", {
                                phase_ID: backendPhase.ID,
                                name: task.name,
                                role: task.role || '',
                                defaultHours: task.defaultHours || 8,
                                sequence: tIdx + 1
                            });
                        });
                    }

                    await oODataModel.submitBatch(BATCH_GROUP);
                    MessageToast.show("Template imported successfully.");
                    await this._loadBackendData();
                } catch (err) {
                    MessageToast.show("Failed to import template.");
                    console.error("Error importing template", err);
                }
            };
            reader.readAsText(file);
        },

        onDeleteProject: function (oEvent) {
            let oItem = oEvent.getSource();
            while (oItem && !oItem.getBindingContext) {
                oItem = oItem.getParent();
            }

            if (!oItem || !oItem.getBindingContext()) {
                MessageToast.show("Could not determine project to delete");
                return;
            }
            const oObj = oItem.getBindingContext().getObject();
            const sId = (oObj.id || oObj.ID || "").toString().trim();
            if (!sId) {
                MessageToast.show("Project ID not found");
                return;
            }

            // Store the project ID so the confirm handler can access it
            this._pendingDeleteProjectId = sId;

            const oView = this.getView();
            if (!this._pDeleteConfirmDialog) {
                this._pDeleteConfirmDialog = this.loadFragment({
                    name: "projectmanagement.view.fragments.DeleteConfirmation"
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pDeleteConfirmDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onDeleteProjectConfirm: async function () {
            // Close the dialog first
            this._pDeleteConfirmDialog.then(function (oDialog) {
                oDialog.close();
            });

            const sId = this._pendingDeleteProjectId;
            if (!sId) return;
            this._pendingDeleteProjectId = null;

            const oODataModel = this._getODataModel();
            try {
                // Delete associated Allocations
                const allocBinding = oODataModel.bindList("/Allocations");
                const allocContexts = await allocBinding.requestContexts(0, 1000);
                allocContexts.forEach(c => {
                    const o = c.getObject ? c.getObject() : {};
                    if (o.project_ID === sId && c.delete) {
                        c.delete(BATCH_GROUP);
                    }
                });

                // Delete associated WBSTasks
                const wbsBinding = oODataModel.bindList("/WBSTasks");
                const wbsContexts = await wbsBinding.requestContexts(0, 1000);
                wbsContexts.forEach(c => {
                    const o = c.getObject ? c.getObject() : {};
                    if (o.project_ID === sId && c.delete) {
                        c.delete(BATCH_GROUP);
                    }
                });

                // Delete associated ProjectRoles
                const roleBinding = oODataModel.bindList("/ProjectRoles");
                const roleContexts = await roleBinding.requestContexts(0, 1000);
                roleContexts.forEach(c => {
                    const o = c.getObject ? c.getObject() : {};
                    if (o.project_ID === sId && c.delete) {
                        c.delete(BATCH_GROUP);
                    }
                });

                const oListBinding = oODataModel.bindList("/Projects");
                const aContexts = await oListBinding.requestContexts(0, 500);
                const oCtx = aContexts.find(function (c) {
                    const o = c.getObject ? c.getObject() : {};
                    return (o.ID || o.id) === sId;
                });
                if (!oCtx) {
                    MessageToast.show("Project not found in service");
                    return;
                }
                if (oCtx.delete) {
                    oCtx.delete(BATCH_GROUP);
                } else {
                    MessageToast.show("Delete not supported");
                    return;
                }
                await oODataModel.submitBatch(BATCH_GROUP);

                // Clear UI state if the deleted project was active in WBS or Timeline
                const oModel = this.getView().getModel();
                if (oModel.getProperty("/wbsSelectedProjectId") === sId) {
                    oModel.setProperty("/wbsSelectedProjectId", "");
                    oModel.setProperty("/wbsTasksForSelectedProject", []);
                }
                if (oModel.getProperty("/timelineSelectedProjectId") === sId) {
                    oModel.setProperty("/timelineSelectedProjectId", "");
                }

                // Immediately remove from local model so the table updates instantly
                const aProjects = oModel.getProperty("/projects") || [];
                const updatedProjects = aProjects.filter(p => p.id !== sId);
                oModel.setProperty("/projects", updatedProjects);
                this._calculateAnalytics(); // Refresh the enrichedProjects list for the table

                MessageToast.show("Project Deleted");
                await this._loadBackendData();
            } catch (e) {
                MessageToast.show("Failed to delete project");
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        onDeleteProjectCancel: function () {
            this._pendingDeleteProjectId = null;
            this._pDeleteConfirmDialog.then(function (oDialog) {
                oDialog.close();
            });
        },

        onAddResource: function () {
            const oModel = this.getView().getModel();
            const count = oModel.getProperty("/resources").length;
            oModel.setProperty("/editingResourceId", null);
            oModel.setProperty("/newResource", { id: `R00${count + 1}`, name: "", type: "Full Time", roles: [], salary: null, officeCost: null, overheadCost: null, hourlyRate: 0 });
            this._openDialog("CreateResource");
        },

        onEditResource: function (oEvent) {
            const oItem = oEvent.getSource().getBindingContext().getObject();
            const oModel = this.getView().getModel();
            const itemCopy = JSON.parse(JSON.stringify(oItem));
            oModel.setProperty("/editingResourceId", itemCopy.id);
            oModel.setProperty("/newResource", itemCopy);
            this._openDialog("CreateResource");
        },

        onResTypeChange: function () {
            const oModel = this.getView().getModel();
            if (oModel.getProperty("/newResource/type") === "Contract") {
                oModel.setProperty("/newResource/officeCost", 0);
                oModel.setProperty("/newResource/overheadCost", 0);
            }
            this.onCalcHourlyRate();
        },

        onCalcHourlyRate: function () {
            const oModel = this.getView().getModel();
            const res = oModel.getProperty("/newResource");
            const total = (parseFloat(res.salary) || 0) + (parseFloat(res.officeCost) || 0) + (parseFloat(res.overheadCost) || 0);
            oModel.setProperty("/newResource/hourlyRate", total > 0 ? Math.round(total / 2080) : 0);
        },


        onSaveResource: async function () {
            const oModel = this.getView().getModel();
            const newRes = oModel.getProperty("/newResource");
            const editId = oModel.getProperty("/editingResourceId");

            if (!newRes.name || !newRes.roles || newRes.roles.length === 0) {
                MessageToast.show("Please fill required fields (Name, Roles)");
                return;
            }

            const oODataModel = this._getODataModel();
            const sResId = (newRes.id || "").toString().trim();
            const sPathResource = "/Resources('" + encodeURIComponent(sResId) + "')";

            try {
                if (editId) {
                    const oCtx = oODataModel.bindContext(sPathResource).getBoundContext();
                    oCtx.setProperty("name", newRes.name);
                    oCtx.setProperty("type", newRes.type || "Full Time");
                    oCtx.setProperty("salary", parseFloat(newRes.salary) || 0);
                    oCtx.setProperty("officeCost", parseFloat(newRes.officeCost) || 0);
                    oCtx.setProperty("overheadCost", parseFloat(newRes.overheadCost) || 0);
                    oCtx.setProperty("hourlyRate", parseFloat(newRes.hourlyRate) || 0);

                    const aExistingRoles = await this._loadResourceRolesForResource(oODataModel, sResId);
                    for (const oRoleCtx of aExistingRoles) {
                        if (oRoleCtx.delete) {
                            oRoleCtx.delete(BATCH_GROUP);
                        }
                    }
                    const roles = (newRes.roles || []);
                    for (const role of roles) {
                        if (role) {
                            this._createEntry(oODataModel, "/ResourceRoles", {
                                resource_ID: sResId,
                                role: typeof role === "string" ? role : (role.role || "")
                            });
                        }
                    }
                } else {
                    this._createEntry(oODataModel, "/Resources", {
                        ID: sResId,
                        name: newRes.name,
                        type: newRes.type || "Full Time",
                        salary: parseFloat(newRes.salary) || 0,
                        officeCost: parseFloat(newRes.officeCost) || 0,
                        overheadCost: parseFloat(newRes.overheadCost) || 0,
                        hourlyRate: parseFloat(newRes.hourlyRate) || 0
                    });
                    const roles = (newRes.roles || []);
                    for (const role of roles) {
                        if (role) {
                            this._createEntry(oODataModel, "/ResourceRoles", {
                                resource_ID: sResId,
                                role: typeof role === "string" ? role : (role.role || "")
                            });
                        }
                    }
                }

                await oODataModel.submitBatch(BATCH_GROUP);
                this.byId("CreateResourceDialog").close();
                MessageToast.show(editId ? "Resource Updated" : "Resource Saved");
                await this._loadBackendData();
            } catch (e) {
                MessageToast.show(editId ? "Failed to update resource" : "Failed to create resource");
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        _loadResourceRolesForResource: async function (oODataModel, sResourceId) {
            const oListBinding = oODataModel.bindList("/ResourceRoles");
            const aContexts = await oListBinding.requestContexts(0, 500);
            return aContexts.filter(function (oCtx) {
                const o = oCtx.getObject ? oCtx.getObject() : {};
                return o.resource_ID === sResourceId;
            });
        },

        onDeleteResource: function (oEvent) {
            let oItem = oEvent.getSource();
            while (oItem && !oItem.getBindingContext) {
                oItem = oItem.getParent();
            }

            if (!oItem || !oItem.getBindingContext()) {
                MessageToast.show("Could not determine resource to delete");
                return;
            }
            const oObj = oItem.getBindingContext().getObject();
            const sId = (oObj.id || oObj.ID || "").toString().trim();
            if (!sId) {
                MessageToast.show("Resource ID not found");
                return;
            }

            const sName = oObj.name || "this resource";

            // Store details for the confirm handler
            this._pendingDeleteResourceId = sId;
            this.getView().getModel().setProperty("/pendingDeleteResourceName", sName);

            const oView = this.getView();
            if (!this._pDeleteResConfirmDialog) {
                this._pDeleteResConfirmDialog = this.loadFragment({
                    name: "projectmanagement.view.fragments.DeleteResourceConfirmation"
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pDeleteResConfirmDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onDeleteResourceConfirm: async function () {
            // Close the dialog first
            if (this._pDeleteResConfirmDialog) {
                this._pDeleteResConfirmDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }

            const sId = this._pendingDeleteResourceId;
            if (!sId) return;
            this._pendingDeleteResourceId = null;

            const oODataModel = this._getODataModel();
            try {
                const oListBinding = oODataModel.bindList("/Resources");
                const aContexts = await oListBinding.requestContexts(0, 500);
                const oCtx = aContexts.find(function (c) {
                    const o = c.getObject ? c.getObject() : {};
                    return (o.ID || o.id) === sId;
                });

                if (!oCtx) {
                    MessageToast.show("Resource not found in service");
                    return;
                }

                if (oCtx.delete) {
                    oCtx.delete(BATCH_GROUP);
                } else {
                    MessageToast.show("Delete not supported");
                    return;
                }

                await oODataModel.submitBatch(BATCH_GROUP);
                MessageToast.show("Resource Deleted");
                await this._loadBackendData();
            } catch (e) {
                MessageToast.show("Failed to delete resource");
                // eslint-disable-next-line no-console
                console.error(e);
            }
        },

        onDeleteResourceCancel: function () {
            this._pendingDeleteResourceId = null;
            if (this._pDeleteResConfirmDialog) {
                this._pDeleteResConfirmDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onAddAllocation: function () {
            this.getView().getModel().setProperty("/newAllocation", { projectId: "" });
            this.getView().getModel().setProperty("/newAllocationSlots", []);
            this.getView().getModel().setProperty("/selectedProjectCapacity", 0);
            this._openDialog("CreateAllocation");
        },

        onAllocProjectChange: function (oEvent) {
            const oSource = oEvent.getSource();
            const oSelectedItem = oEvent.getParameter("selectedItem");

            // Be defensive: fall back to selectedKey if selectedItem is not available
            const projectId = oSelectedItem ? oSelectedItem.getKey() : oSource.getSelectedKey();

            const oModel = this.getView().getModel();
            const proj = oModel.getProperty("/projects").find(p => p.id === projectId);

            // Store the selected project on the view model so onSaveAllocation can read it
            oModel.setProperty("/newAllocation/projectId", projectId);

            if (!projectId) {
                // eslint-disable-next-line no-console
                console.error("onAllocProjectChange: No projectId resolved from ComboBox", {
                    selectedItem: oSelectedItem,
                    selectedKey: oSource.getSelectedKey()
                });
                return;
            }

            if (!proj) {
                // eslint-disable-next-line no-console
                console.error("onAllocProjectChange: Project not found for id", projectId, "Projects:", oModel.getProperty("/projects"));
                return;
            }
            const existingAllocs = oModel.getProperty("/allocations").filter(a => a.projectId === projectId);

            oModel.setProperty("/selectedProjectCapacity", this.getWorkingHours(proj.startDate, proj.endDate));
            oModel.setProperty("/selectedProjectStartDate", proj.startDate);
            oModel.setProperty("/selectedProjectEndDate", proj.endDate);

            const slots = [];
            const fulfilledRoles = {};

            existingAllocs.forEach((alloc, idx) => {
                const isCustom = !proj.requiredRoles.some(req => req.role === alloc.role);
                slots.push({ id: `slot_ext_${idx}`, role: alloc.role || '', resourceId: alloc.resourceId, hours: alloc.hours, customRole: isCustom });
                if (alloc.role && !isCustom) fulfilledRoles[alloc.role] = (fulfilledRoles[alloc.role] || 0) + 1;
            });

            if (proj.requiredRoles) {
                proj.requiredRoles.forEach((req, idx) => {
                    const remaining = req.count - (fulfilledRoles[req.role] || 0);
                    for (let i = 0; i < remaining; i++) {
                        slots.push({ id: `slot_req_${idx}_${i}`, role: req.role, resourceId: "", hours: null, customRole: false });
                    }
                });
            }

            if (slots.length === 0) slots.push({ id: "slot_custom_0", role: "", resourceId: "", hours: null, customRole: true });
            oModel.setProperty("/newAllocationSlots", slots);
        },

        onAddAllocSlot: function () {
            const slots = this.getView().getModel().getProperty("/newAllocationSlots");
            slots.push({ id: `slot_custom_${Date.now()}`, role: "", resourceId: "", hours: null, customRole: true });
            this.getView().getModel().setProperty("/newAllocationSlots", slots);
        },

        onRemoveAllocSlot: function (oEvent) {
            const path = oEvent.getSource().getBindingContext().getPath();
            const idx = parseInt(path.split("/").pop());
            const slots = this.getView().getModel().getProperty("/newAllocationSlots");
            slots.splice(idx, 1);
            this.getView().getModel().setProperty("/newAllocationSlots", slots);
        },

        onSaveAllocation: async function () {
            if (this._isSavingAllocation) return;
            this._isSavingAllocation = true;

            const oModel = this.getView().getModel();

            try {
                const projectId = oModel.getProperty("/newAllocation/projectId");
                const slots = oModel.getProperty("/newAllocationSlots");

                // 1) Must have a project
                if (!projectId) {
                    // eslint-disable-next-line no-console
                    console.error("onSaveAllocation: No projectId set on /newAllocation", oModel.getProperty("/newAllocation"));
                    MessageToast.show("Please select a project");
                    this._isSavingAllocation = false;
                    return;
                }

                // 2) Must have at least one slot row
                if (!Array.isArray(slots) || !slots.length) {
                    // eslint-disable-next-line no-console
                    console.error("onSaveAllocation: No allocation slots available", slots);
                    MessageToast.show("Please assign at least one resource with hours");
                    this._isSavingAllocation = false;
                    return;
                }

                // 3) Each saved row must have a resource + hours > 0
                const validSlots = slots.filter(s => s.resourceId && parseInt(s.hours, 10) > 0);
                if (!validSlots.length) {
                    // eslint-disable-next-line no-console
                    console.error("onSaveAllocation: No valid slots (need resourceId and hours > 0). Current slots:", slots);
                    MessageToast.show("Please assign at least one resource with hours");
                    this._isSavingAllocation = false;
                    return;
                }

                const oODataModel = this._getODataModel();
                const sProjectId = String(projectId).trim();

                // 4) Delete existing allocations for this project (in backend)
                const oAllocListBinding = oODataModel.bindList("/Allocations");
                const aAllocContexts = await oAllocListBinding.requestContexts(0, 500);
                const aExistingForProject = aAllocContexts.filter(function (c) {
                    const o = c.getObject ? c.getObject() : {};
                    return (o.project_ID || o.projectId) === sProjectId;
                });

                for (const oCtx of aExistingForProject) {
                    if (oCtx.delete) {
                        oCtx.delete(BATCH_GROUP);
                    }
                }

                // 5) Create new allocations from the current slots (in backend)
                for (const s of validSlots) {
                    this._createEntry(oODataModel, "/Allocations", {
                        project_ID: sProjectId,
                        resource_ID: String(s.resourceId).trim(),
                        role: (s.role || "").toString(),
                        hours: parseInt(s.hours, 10) || 0
                    });
                }

                // 6) Submit the batch, close dialog, and reload data
                await oODataModel.submitBatch(BATCH_GROUP);
                this.byId("CreateAllocationDialog").close();
                MessageToast.show("Allocations Updated");
                await this._loadBackendData();

            } catch (e) {
                MessageToast.show("Failed to save allocations");
                // eslint-disable-next-line no-console
                console.error("Error in onSaveAllocation", e);
            } finally {
                this._isSavingAllocation = false;
            }
        },

        // --- WBS Logic ---
        onWbsProjectChange: function () {
            this._computeWbsTasks();
            this._computeTimelineData();
        },

        _computeWbsTasks: function () {
            const oModel = this.getView().getModel();
            const pid = oModel.getProperty("/wbsSelectedProjectId");
            const allTasks = oModel.getProperty("/wbsTasks") || [];

            const filteredTasks = allTasks.filter(t => t.projectId === pid)
                .sort((a, b) => {
                    const phaseA = a.phaseName || "";
                    const phaseB = b.phaseName || "";
                    // Group by exact phase name alphabetically
                    if (phaseA < phaseB) return -1;
                    if (phaseA > phaseB) return 1;
                    // Secondary sort by sequence integer
                    return (a.sequence || 0) - (b.sequence || 0);
                }).map((t, idx) => {
                    t.index = idx + 1;
                    t.startDateEdit = t.startDate ? t.startDate.slice(0, 10) : "";
                    t.endDateEdit = t.endDate ? t.endDate.slice(0, 10) : "";
                    return t;
                });
            oModel.setProperty("/wbsTasksForSelectedProject", filteredTasks);
        },

        calculateEndDate: function (startDateStr, hours) {
            if (!startDateStr || !hours || hours <= 0) return startDateStr;
            const sDate = new Date(startDateStr + 'T00:00:00');
            if (isNaN(sDate.getTime())) return startDateStr;

            const daysNeeded = Math.ceil(hours / 8);
            let currentDays = 0;
            const date = new Date(sDate.getTime());

            if (date.getDay() !== 0 && date.getDay() !== 6) {
                currentDays = 1;
            }

            while (currentDays < daysNeeded) {
                date.setDate(date.getDate() + 1);
                if (date.getDay() !== 0 && date.getDay() !== 6) {
                    currentDays++;
                }
            }

            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },

        getNextWorkingDay: function (dateStr) {
            if (!dateStr) return '';
            const date = new Date(dateStr + 'T00:00:00');
            if (isNaN(date.getTime())) return '';

            date.setDate(date.getDate() + 1);
            while (date.getDay() === 0 || date.getDay() === 6) {
                date.setDate(date.getDate() + 1);
            }
            const y = date.getFullYear();
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${y}-${m}-${d}`;
        },

        onAddWbsTask: async function () {
            const oModel = this.getView().getModel();
            const projId = oModel.getProperty("/wbsSelectedProjectId");
            if (!projId) return;

            const projects = oModel.getProperty("/projects") || [];
            const p = projects.find(x => x.id === projId);
            const defaultHours = 8;
            const endDate = p && p.startDate ? this.calculateEndDate(p.startDate, defaultHours) : (p ? p.endDate : '');

            const oODataModel = this._getODataModel();
            try {
                this._createEntry(oODataModel, "/WBSTasks", {
                    project_ID: projId,
                    phaseName: 'New Phase',
                    name: 'New Task',
                    role: '',
                    resource_ID: null,
                    hours: defaultHours,
                    startDate: this._formatDateForOData(p ? p.startDate : null),
                    endDate: this._formatDateForOData(endDate),
                    status: 'Not Started',
                    sequence: (oModel.getProperty("/wbsTasks") || []).filter(t => t.projectId === projId).length + 1,
                    predecessor_ID: null
                });
                await oODataModel.submitBatch(BATCH_GROUP);
                await this._loadBackendData();
                MessageToast.show("Task added");
            } catch (e) {
                MessageToast.show("Failed to add WBS task");
                console.error("Error adding WBS task", e);
            }
        },

        onDeleteAllWbsTasks: function () {
            const oModel = this.getView().getModel();
            const projId = oModel.getProperty("/wbsSelectedProjectId");

            if (!projId) return;

            sap.m.MessageBox.warning("Are you sure you want to delete ALL tasks for this project? This will permanently wipe them from the database.", {
                title: "Delete All Tasks",
                actions: [sap.m.MessageBox.Action.DELETE, sap.m.MessageBox.Action.CANCEL],
                emphasizedAction: sap.m.MessageBox.Action.CANCEL,
                onClose: async (sAction) => {
                    if (sAction === sap.m.MessageBox.Action.DELETE) {
                        try {
                            const oODataModel = this._getODataModel();
                            const oListBinding = oODataModel.bindList("/WBSTasks");
                            const aContexts = await oListBinding.requestContexts(0, 5000);

                            let count = 0;
                            aContexts.forEach(c => {
                                const obj = c.getObject ? c.getObject() : {};
                                if (obj.project_ID === projId && c.delete) {
                                    c.delete(BATCH_GROUP);
                                    count++;
                                }
                            });

                            if (count > 0) {
                                await oODataModel.submitBatch(BATCH_GROUP);
                                sap.m.MessageToast.show(`Successfully deleted all ${count} tasks`);
                                await this._loadBackendData();
                            } else {
                                sap.m.MessageToast.show("No tasks found to delete for this project");
                            }
                        } catch (e) {
                            console.error("Error deleting all tasks", e);
                            sap.m.MessageToast.show("Failed to clear tasks from database");
                        }
                    }
                }
            });
        },

        onRemoveWbsTask: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            const sId = task.id;
            const sName = task.name || "this task";

            this._pendingDeleteWbsTaskId = sId;
            this.getView().getModel().setProperty("/pendingDeleteWbsTaskName", sName);

            const oView = this.getView();
            if (!this._pDeleteWbsTaskConfirmDialog) {
                this._pDeleteWbsTaskConfirmDialog = this.loadFragment({
                    name: "projectmanagement.view.fragments.DeleteWbsTaskConfirmation"
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pDeleteWbsTaskConfirmDialog.then(function (oDialog) {
                oDialog.open();
            });
        },

        onDeleteWbsTaskConfirm: async function () {
            if (this._pDeleteWbsTaskConfirmDialog) {
                this._pDeleteWbsTaskConfirmDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }

            const taskId = this._pendingDeleteWbsTaskId;
            if (!taskId) return;
            this._pendingDeleteWbsTaskId = null;

            const oODataModel = this._getODataModel();
            try {
                const oListBinding = oODataModel.bindList("/WBSTasks");
                const aContexts = await oListBinding.requestContexts(0, 1000);
                const oTaskCtx = aContexts.find(c => {
                    const o = c.getObject ? c.getObject() : {};
                    return o.ID === taskId;
                });
                if (oTaskCtx && oTaskCtx.delete) {
                    oTaskCtx.delete(BATCH_GROUP);
                }
                await oODataModel.submitBatch(BATCH_GROUP);
                await this._loadBackendData();
                MessageToast.show("Task removed");
            } catch (e) {
                MessageToast.show("Failed to remove WBS task");
                console.error("Error removing WBS task", e);
            }
        },

        onDeleteWbsTaskCancel: function () {
            this._pendingDeleteWbsTaskId = null;
            if (this._pDeleteWbsTaskConfirmDialog) {
                this._pDeleteWbsTaskConfirmDialog.then(function (oDialog) {
                    oDialog.close();
                });
            }
        },

        onUpdateWbsTask: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            this._syncWbsTaskToMain(task);
        },

        onUpdateWbsTaskHours: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            task.hours = parseFloat(task.hours) || 0;
            task.endDate = this.calculateEndDate(task.startDate, task.hours);
            this._syncWbsTaskToMain(task);
            // Cascade to other tasks with the same resource
            if (task.resourceId) {
                this._recalculateResourceSchedule(task.projectId, task.resourceId);
            }
        },

        onUpdateWbsTaskStartDate: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            task.startDate = task.startDateEdit || "";
            task.endDate = this.calculateEndDate(task.startDate, task.hours);
            this._syncWbsTaskToMain(task);
            // Cascade to other tasks with the same resource
            if (task.resourceId) {
                this._recalculateResourceSchedule(task.projectId, task.resourceId);
            }
        },

        onUpdateWbsTaskEndDate: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            task.endDate = task.endDateEdit || "";
            task.hours = this.getWorkingHours(task.startDate, task.endDateEdit);
            this._syncWbsTaskToMain(task);
            // Cascade to other tasks with the same resource
            if (task.resourceId) {
                this._recalculateResourceSchedule(task.projectId, task.resourceId);
            }
        },

        onUpdateWbsTaskPredecessor: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            this._syncWbsTaskToMain(task);
        },

        onUpdateWbsTaskResource: function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const task = oContext.getObject();
            const oModel = this.getView().getModel();
            const allTasks = oModel.getProperty("/wbsTasks") || [];

            if (task.resourceId) {
                // Find other tasks with the same resource in the same project
                const otherTasks = allTasks.filter(ot =>
                    ot.projectId === task.projectId &&
                    ot.resourceId === task.resourceId &&
                    ot.id !== task.id &&
                    ot.endDate
                );
                if (otherTasks.length > 0) {
                    const maxEndDate = otherTasks.reduce((max, ot) =>
                        ot.endDate > max ? ot.endDate : max, otherTasks[0].endDate);
                    if (maxEndDate) {
                        const nextStartDate = this.getNextWorkingDay(maxEndDate);
                        if (nextStartDate) {
                            task.startDate = nextStartDate;
                            task.startDateEdit = nextStartDate;
                            task.endDate = this.calculateEndDate(nextStartDate, task.hours);
                            task.endDateEdit = task.endDate;
                        }
                    }
                } else {
                    // Resource has no other tasks in this project; start at project start date
                    const projects = oModel.getProperty("/projects") || [];
                    const p = projects.find(x => x.id === task.projectId);
                    if (p && p.startDate) {
                        task.startDate = p.startDate;
                        task.startDateEdit = p.startDate;
                        task.endDate = this.calculateEndDate(p.startDate, task.hours);
                        task.endDateEdit = task.endDate;
                    }
                }
            }
            this._syncWbsTaskToMain(task);
            if (task.resourceId) {
                this._recalculateResourceSchedule(task.projectId, task.resourceId);
            }
        },

        /**
         * Recalculates dates for all tasks sharing the same resource in a project.
         * Tasks are sorted by start date and chained: each subsequent task starts
         * on the next working day after the previous task ends.
         */
        _recalculateResourceSchedule: function (projectId, resourceId) {
            if (!resourceId) return;
            const oModel = this.getView().getModel();
            const allTasks = oModel.getProperty("/wbsTasks") || [];

            // Get all tasks for this resource in this project
            const resourceTasks = allTasks.filter(t =>
                t.projectId === projectId && t.resourceId === resourceId
            );

            if (resourceTasks.length <= 1) return;

            // Sort by start date (earliest first)
            resourceTasks.sort((a, b) => {
                const aDate = a.startDate || "9999-12-31";
                const bDate = b.startDate || "9999-12-31";
                return aDate.localeCompare(bDate);
            });

            // Chain dates: each subsequent task starts after the previous one ends
            let changed = false;
            for (let i = 1; i < resourceTasks.length; i++) {
                const prevTask = resourceTasks[i - 1];
                const currTask = resourceTasks[i];

                if (prevTask.endDate) {
                    const nextStart = this.getNextWorkingDay(prevTask.endDate);
                    if (nextStart && currTask.startDate !== nextStart) {
                        currTask.startDate = nextStart;
                        currTask.startDateEdit = nextStart;
                        currTask.endDate = this.calculateEndDate(nextStart, currTask.hours || 0);
                        currTask.endDateEdit = currTask.endDate;

                        // Update in allTasks array
                        const idx = allTasks.findIndex(t => t.id === currTask.id);
                        if (idx > -1) {
                            allTasks[idx] = { ...currTask };
                        }
                        // Persist cascaded task to backend
                        this._syncWbsTaskToMain(currTask);
                        changed = true;
                    }
                }
            }

            if (changed) {
                oModel.setProperty("/wbsTasks", allTasks);
                this._computeWbsTasks();
                this._computeTimelineData();
                this._calculateAnalytics();
            }
        },

        _syncWbsTaskToMain: async function (taskData) {
            const oModel = this.getView().getModel();
            const allTasks = oModel.getProperty("/wbsTasks") || [];
            const idx = allTasks.findIndex(t => t.id === taskData.id);
            if (idx > -1) {
                allTasks[idx] = { ...taskData };
                oModel.setProperty("/wbsTasks", allTasks);
                this._computeWbsTasks();
                this._computeTimelineData();
                this._calculateAnalytics();
            }

            // Persist to backend
            const oODataModel = this._getODataModel();
            try {
                const oCtx = oODataModel.bindContext("/WBSTasks(" + taskData.id + ")").getBoundContext();
                oCtx.setProperty("phaseName", taskData.phaseName || '');
                oCtx.setProperty("name", taskData.name || '');
                oCtx.setProperty("role", taskData.role || '');
                oCtx.setProperty("resource_ID", taskData.resourceId || null);
                oCtx.setProperty("hours", parseInt(taskData.hours) || 0);
                oCtx.setProperty("startDate", this._formatDateForOData(taskData.startDate));
                oCtx.setProperty("endDate", this._formatDateForOData(taskData.endDate));
                oCtx.setProperty("predecessor_ID", taskData.predecessor || null);
                await oODataModel.submitBatch(BATCH_GROUP);
            } catch (e) {
                console.error("Error syncing WBS task to backend", e);
            }
        },

        _autoImportTemplateToWBS: async function (sProjectId, sTemplateId, sProjectStartDate, bDeleteExisting) {
            const oModel = this.getView().getModel();
            const oODataModel = this._getODataModel();
            const templateTaskMap = JSON.parse(localStorage.getItem("projectTemplateTasks") || "{}");

            try {
                // Step 1: Delete ONLY old template-originated tasks (not manually added ones)
                if (bDeleteExisting) {
                    const oldTaskIds = templateTaskMap[sProjectId] || [];
                    if (oldTaskIds.length > 0) {
                        const oListBinding = oODataModel.bindList("/WBSTasks");
                        const aContexts = await oListBinding.requestContexts(0, 5000);
                        for (const oCtx of aContexts) {
                            const o = oCtx.getObject ? oCtx.getObject() : {};
                            if (oldTaskIds.includes(o.ID)) {
                                if (oCtx.delete) {
                                    oCtx.delete(BATCH_GROUP);
                                }
                            }
                        }
                        await oODataModel.submitBatch(BATCH_GROUP);
                        await this._loadBackendData();
                    }
                    // Clear old mapping for this project
                    delete templateTaskMap[sProjectId];
                    localStorage.setItem("projectTemplateTasks", JSON.stringify(templateTaskMap));
                }

                // Step 2: If no new template selected, we're done (user cleared the template)
                if (!sTemplateId) {
                    if (bDeleteExisting) {
                        MessageToast.show("Old template tasks removed from WBS");
                    }
                    return;
                }

                // Step 3: Record existing task IDs before import so we can identify new ones after
                const existingTaskIds = (oModel.getProperty("/wbsTasks") || [])
                    .filter(t => t.projectId === sProjectId)
                    .map(t => t.id);

                const tpl = (oModel.getProperty("/templates") || []).find(t => t.id === sTemplateId);
                if (!tpl || !tpl.phases) return;

                const resources = oModel.getProperty("/resources") || [];
                let seq = existingTaskIds.length;

                tpl.phases.forEach(phase => {
                    if (phase.tasks) {
                        phase.tasks.forEach(task => {
                            seq++;
                            const matchedResource = resources.find(r => r.name === task.role);
                            this._createEntry(oODataModel, "/WBSTasks", {
                                project_ID: sProjectId,
                                phaseName: phase.name,
                                name: task.name,
                                role: task.role || '',
                                resource_ID: matchedResource ? matchedResource.id : null,
                                hours: task.defaultHours || 8,
                                startDate: this._formatDateForOData(sProjectStartDate),
                                endDate: this._formatDateForOData(this.calculateEndDate(sProjectStartDate, task.defaultHours || 8)),
                                status: 'Not Started',
                                sequence: seq,
                                predecessor_ID: null
                            });
                        });
                    }
                });

                await oODataModel.submitBatch(BATCH_GROUP);
                await this._loadBackendData();

                // Step 4: Identify newly created task IDs and store them in localStorage
                const allTaskIds = (oModel.getProperty("/wbsTasks") || [])
                    .filter(t => t.projectId === sProjectId)
                    .map(t => t.id);
                const newTaskIds = allTaskIds.filter(id => !existingTaskIds.includes(id));

                const updatedMap = JSON.parse(localStorage.getItem("projectTemplateTasks") || "{}");
                updatedMap[sProjectId] = newTaskIds;
                localStorage.setItem("projectTemplateTasks", JSON.stringify(updatedMap));

                MessageToast.show("Template tasks imported into WBS");
            } catch (e) {
                MessageToast.show("Project saved but failed to import template tasks");
                console.error("Error auto-importing template to WBS", e);
            }
        },

        handleWbsImport: function (oEvent) {
            const file = oEvent.getParameter("files")[0];
            if (!file) return;

            const oModel = this.getView().getModel();
            const projId = oModel.getProperty("/wbsSelectedProjectId");
            if (!projId) {
                MessageToast.show("Please select a project first.");
                return;
            }

            const proj = (oModel.getProperty("/projects") || []).find(p => p.id === projId);

            const reader = new FileReader();
            reader.onload = async (e) => {
                const text = e.target.result;
                const parsedData = this.parseCSV(text);

                if (parsedData.length === 0) {
                    MessageToast.show("CSV is empty or invalid format.");
                    return;
                }

                const oODataModel = this._getODataModel();
                const existingTasks = (oModel.getProperty("/wbsTasks") || []).filter(t => t.projectId === projId);
                let seq = existingTasks.length;

                try {
                    parsedData.forEach((row) => {
                        const phase = row.phase || 'Imported Phase';
                        const taskName = row.task || row['task name'] || 'Imported Task';
                        const hoursStr = row.hours || row['default hours'] || row['hrs'];
                        const hours = parseInt(hoursStr) || 8;
                        const role = row.role || '';

                        let startDate = row['start date'] || row.startdate || row.start;
                        if (!startDate || isNaN(new Date(startDate + 'T00:00:00').getTime())) {
                            startDate = proj ? proj.startDate : '';
                        }

                        seq++;
                        this._createEntry(oODataModel, "/WBSTasks", {
                            project_ID: projId,
                            phaseName: phase,
                            name: taskName,
                            role: role,
                            resource_ID: null,
                            hours: hours,
                            startDate: this._formatDateForOData(startDate),
                            endDate: this._formatDateForOData(this.calculateEndDate(startDate, hours)),
                            status: 'Not Started',
                            sequence: seq,
                            predecessor_ID: null
                        });
                    });

                    await oODataModel.submitBatch(BATCH_GROUP);
                    MessageToast.show("Successfully imported tasks from CSV.");
                    await this._loadBackendData();
                } catch (err) {
                    MessageToast.show("Failed to import WBS tasks from CSV.");
                    console.error("Error importing WBS from CSV", err);
                }
            };
            reader.readAsText(file);
        },

        onImportCSV: function () {
            // Trigger the hidden FileUploader's file dialog
            var oFileUploader = this.byId("wbsExcelFileUploader");
            if (oFileUploader) {
                // Access the internal file input and click it
                var oDomRef = oFileUploader.getDomRef();
                if (oDomRef) {
                    var oInput = oDomRef.querySelector("input[type='file']");
                    if (oInput) {
                        oInput.click();
                        return;
                    }
                }
                // Fallback: use FeedInput or create a temporary file input
                var oTempInput = document.createElement("input");
                oTempInput.type = "file";
                oTempInput.accept = ".xlsx,.xls,.csv";
                oTempInput.style.display = "none";
                document.body.appendChild(oTempInput);

                var that = this;
                oTempInput.addEventListener("change", function (evt) {
                    var file = evt.target.files[0];
                    if (file) {
                        that._processImportedFile(file);
                    }
                    document.body.removeChild(oTempInput);
                });
                oTempInput.click();
            }
        },

        onImportExcelFile: function (oEvent) {
            var aFiles = oEvent.getParameter("files");
            var file = aFiles && aFiles[0];
            if (!file) return;
            this._processImportedFile(file);
        },

        _loadXLSXLibrary: function () {
            // Dynamically load SheetJS if not already available
            return new Promise(function (resolve, reject) {
                if (window.XLSX) {
                    resolve(window.XLSX);
                    return;
                }
                var script = document.createElement("script");
                script.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
                script.onload = function () {
                    if (window.XLSX) {
                        resolve(window.XLSX);
                    } else {
                        reject(new Error("XLSX library failed to initialize"));
                    }
                };
                script.onerror = function () {
                    reject(new Error("Failed to load XLSX library from CDN"));
                };
                document.head.appendChild(script);
            });
        },

        _processImportedFile: function (file) {
            var oModel = this.getView().getModel();
            var projId = oModel.getProperty("/wbsSelectedProjectId");
            if (!projId) {
                MessageToast.show("Please select a project first.");
                return;
            }

            var that = this;

            this._loadXLSXLibrary().then(function (XLSX) {
                var reader = new FileReader();

                reader.onload = function (e) {
                    try {
                        var data = new Uint8Array(e.target.result);
                        var workbook = XLSX.read(data, { type: "array" });
                        var sheetName = workbook.SheetNames[0];
                        var worksheet = workbook.Sheets[sheetName];
                        var jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                        if (!jsonData || jsonData.length === 0) {
                            MessageToast.show("File is empty or has invalid format.");
                            return;
                        }

                        that._importExcelRows(jsonData, projId);
                    } catch (err) {
                        MessageToast.show("Failed to parse file. Please ensure it is a valid Excel/CSV file.");
                        console.error("Error parsing imported file", err);
                    }
                };

                reader.readAsArrayBuffer(file);
            }).catch(function (err) {
                MessageToast.show("Failed to load Excel parsing library.");
                console.error("XLSX library load error", err);
            });
        },

        _findColumnValue: function (row, candidates) {
            // Try to find a column value by checking multiple candidate header names (case-insensitive)
            var keys = Object.keys(row);
            for (var i = 0; i < candidates.length; i++) {
                var candidate = candidates[i].toLowerCase();
                for (var j = 0; j < keys.length; j++) {
                    if (keys[j].toLowerCase().trim() === candidate) {
                        return (row[keys[j]] || "").toString().trim();
                    }
                }
            }
            return "";
        },

        _importExcelRows: async function (jsonData, projId) {
            var oModel = this.getView().getModel();
            var projects = oModel.getProperty("/projects") || [];
            var resources = oModel.getProperty("/resources") || [];
            var proj = projects.find(function (p) { return p.id === projId; });

            if (!proj) {
                MessageToast.show("Selected project not found.");
                return;
            }

            var projectStartDate = proj.startDate || "";
            var oODataModel = this._getODataModel();
            var existingTasks = (oModel.getProperty("/wbsTasks") || []).filter(function (t) { return t.projectId === projId; });
            var seq = existingTasks.length;

            // Track per-resource latest end date for chaining
            var resourceEndDateMap = {};

            // First, build up the end dates from existing tasks for each resource
            existingTasks.forEach(function (t) {
                if (t.resourceId && t.endDate) {
                    if (!resourceEndDateMap[t.resourceId] || t.endDate > resourceEndDateMap[t.resourceId]) {
                        resourceEndDateMap[t.resourceId] = t.endDate;
                    }
                }
            });

            // Parse all rows first to calculate dates correctly with resource chaining
            var parsedTasks = [];
            var that = this;

            jsonData.forEach(function (row) {
                var phaseName = that._findColumnValue(row, ["phase / criticality", "phase/criticality", "phase", "criticality"]);
                var taskName = that._findColumnValue(row, ["task name", "task", "name"]);
                var hoursStr = that._findColumnValue(row, ["hrs", "hours", "hour", "default hours"]);
                var predecessorStr = that._findColumnValue(row, ["predecessor", "predecessors", "pred"]);
                var resourceName = that._findColumnValue(row, ["resource", "resource name", "assigned resource", "resources"]);

                if (!taskName) return; // Skip rows without a task name

                var hours = parseInt(hoursStr) || 8;
                var predecessor = predecessorStr ? predecessorStr.toString().trim() : "";

                // Find matching resource by name (case-insensitive)
                var matchedResource = null;
                if (resourceName) {
                    matchedResource = resources.find(function (r) {
                        return r.name.toLowerCase().trim() === resourceName.toLowerCase().trim();
                    });
                }

                var resourceId = matchedResource ? matchedResource.id : null;

                // Calculate start date based on resource chaining
                var startDate = "";
                if (resourceId && resourceEndDateMap[resourceId]) {
                    // Same resource has a previous task — chain from its end date
                    startDate = that.getNextWorkingDay(resourceEndDateMap[resourceId]);
                } else {
                    // First task for this resource or no resource — use project start date
                    startDate = projectStartDate;
                }

                // Calculate end date based on hours
                var endDate = that.calculateEndDate(startDate, hours);

                // Update the resource end date map for chaining
                if (resourceId) {
                    resourceEndDateMap[resourceId] = endDate;
                }

                seq++;
                parsedTasks.push({
                    projectId: projId,
                    phaseName: phaseName || "Imported Phase",
                    name: taskName,
                    hours: hours,
                    predecessor: predecessor,
                    resourceId: resourceId,
                    startDate: startDate,
                    endDate: endDate,
                    sequence: seq
                });
            });

            if (parsedTasks.length === 0) {
                MessageToast.show("No valid tasks found in the file. Please check column headers.");
                return;
            }

            // Create all tasks in OData backend
            try {
                parsedTasks.forEach(function (task) {
                    // Truncate strings to fit backend schema limits
                    var safeName = (task.name || "").substring(0, 100);
                    var safePhase = (task.phaseName || "").substring(0, 100);
                    var safePredecessor = (task.predecessor || "").substring(0, 100);

                    that._createEntry(oODataModel, "/WBSTasks", {
                        project_ID: task.projectId,
                        phaseName: safePhase,
                        name: safeName,
                        role: "",
                        resource_ID: task.resourceId,
                        hours: task.hours,
                        startDate: that._formatDateForOData(task.startDate),
                        endDate: that._formatDateForOData(task.endDate),
                        status: "Not Started",
                        sequence: task.sequence,
                        predecessor_ID: safePredecessor || null
                    });
                });

                await oODataModel.submitBatch(BATCH_GROUP);
                MessageToast.show("Successfully imported " + parsedTasks.length + " tasks from file.");
                await this._loadBackendData();
            } catch (err) {
                MessageToast.show("Failed to import tasks from file.");
                console.error("Error importing tasks from Excel", err);
            }
        },

        // --- Timeline & WBS Logic ---
        onUpdateWbsTaskReallocation: async function (oEvent) {
            const oContext = oEvent.getSource().getBindingContext();
            const sTaskId = oContext.getProperty("id");
            const sStatus = oContext.getProperty("status");

            if (sStatus === "Completed") {
                sap.m.MessageBox.error("This task is already marked as 'Completed'. You cannot reallocate a completed task.");
                this._loadBackendData(); // Revert the UI to backend state
                return;
            }

            const newReallocatedToId = oEvent.getParameter("selectedItem") ? oEvent.getParameter("selectedItem").getKey() : null;

            const oODataModel = this._getODataModel();
            const oBoundCtx = oODataModel.bindContext("/WBSTasks(" + sTaskId + ")").getBoundContext();
            oBoundCtx.setProperty("reallocatedTo_ID", newReallocatedToId || null);

            try {
                await oODataModel.submitBatch(BATCH_GROUP);
                sap.m.MessageToast.show("Task reallocation saved");
                await this._loadBackendData();
            } catch (e) {
                sap.m.MessageToast.show("Failed to assign new reallocation");
                console.error(e);
            }
        },

        onTimelineProjectChange: function () {
            this._computeTimelineData();
        },

        onSetTimelineTasks: function () {
            this.getView().getModel().setProperty("/timelineActiveSection", "tasks");
        },

        onSetTimelineResources: function () {
            this.getView().getModel().setProperty("/timelineActiveSection", "resources");
        },

        _computeTimelineData: function () {
            const oModel = this.getView().getModel();
            const pId = oModel.getProperty("/timelineSelectedProjectId");
            if (!pId) {
                oModel.setProperty("/timelineData", null);
                oModel.setProperty("/timelineResourceData", []);
                return;
            }

            const projects = oModel.getProperty("/projects") || [];
            const proj = projects.find(p => p.id === pId);
            if (!proj) return;

            const allWbsTasks = oModel.getProperty("/wbsTasks") || [];
            const tasks = allWbsTasks
                .filter(t => t.projectId === pId && t.startDate && t.endDate)
                .map(t => {
                    const startTs = this._parseDateToUtcMidnightTimestamp(t.startDate);
                    const endTs = this._parseDateToUtcMidnightTimestamp(t.endDate);
                    return Object.assign({}, t, {
                        _startTs: startTs,
                        _endTs: endTs
                    });
                })
                .filter(t => Number.isFinite(t._startTs) && Number.isFinite(t._endTs) && t._endTs >= t._startTs);

            if (tasks.length === 0) {
                oModel.setProperty("/timelineData", { proj: proj, tasks: [], weeks: [] });
                oModel.setProperty("/timelineResourceData", []);
                return;
            }

            const minTime = Math.min(...tasks.map(t => t._startTs));
            const maxTime = Math.max(...tasks.map(t => t._endTs));

            const pStart = this._parseDateToUtcMidnightTimestamp(proj.startDate);
            const pEnd = this._parseDateToUtcMidnightTimestamp(proj.endDate);
            const startTimestamp = Number.isFinite(pStart) ? Math.min(minTime, pStart) : minTime;
            const endTimestamp = Number.isFinite(pEnd) ? Math.max(maxTime, pEnd) : maxTime;

            // Calculate total days inclusive (e.g., Mar 4 to Mar 5 is 2 days)
            const msPerDay = 1000 * 3600 * 24;
            const totalDurationDays = Math.max(1, Math.floor((endTimestamp - startTimestamp) / msPerDay) + 1);

            const resources = oModel.getProperty("/resources") || [];

            // Build the full list of day timestamps for proper bar alignment
            var timelineDayTimestamps = [];
            {
                var d = new Date(startTimestamp);
                d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
                var dEnd = new Date(endTimestamp);
                dEnd = new Date(Date.UTC(dEnd.getFullYear(), dEnd.getMonth(), dEnd.getDate()));
                while (d <= dEnd) {
                    timelineDayTimestamps.push(d.getTime());
                    d.setUTCDate(d.getUTCDate() + 1);
                }
            }
            var totalCells = timelineDayTimestamps.length;
            var cellWidthPx = 28;

            var enrichedTasks = tasks.map(function (t) {
                var startDayIndex = Math.floor((t._startTs - startTimestamp) / msPerDay);
                var endDayIndex = Math.floor((t._endTs - startTimestamp) / msPerDay);
                var safeStartDay = Math.max(0, Math.min(totalCells - 1, startDayIndex));
                var safeEndDay = Math.max(safeStartDay, Math.min(totalCells - 1, endDayIndex));
                var daySpan = Math.max(1, (safeEndDay - safeStartDay) + 1);

                var leftPct = totalCells > 0 ? (safeStartDay / totalCells) * 100 : 0;
                var widthPct = totalCells > 0 ? (daySpan / totalCells) * 100 : 100;
                if ((leftPct + widthPct) > 100) {
                    widthPct = Math.max(0, 100 - leftPct);
                }
                var leftPx = safeStartDay * cellWidthPx;
                var widthPx = daySpan * cellWidthPx;

                var res = resources.find(function (r) { return r.id === t.resourceId; });
                var taskForUi = Object.assign({}, t);
                delete taskForUi._startTs;
                delete taskForUi._endTs;
                return Object.assign(taskForUi, {
                    leftPct: Math.max(0, Math.min(100, leftPct)),
                    widthPct: Math.max(0, Math.min(100, widthPct)),
                    leftPx: leftPx,
                    widthPx: widthPx,
                    resourceName: res ? res.name : 'Unassigned'
                });
            });

            const weeks = [];
            const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            // Use UTC to avoid DST shifts creating duplicate/missing days
            let currentDay = new Date(startTimestamp);
            currentDay = new Date(Date.UTC(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate()));

            let endDay = new Date(endTimestamp);
            endDay = new Date(Date.UTC(endDay.getFullYear(), endDay.getMonth(), endDay.getDate()));

            let weekIndex = 1;

            if (totalDurationDays > 0) {
                while (currentDay <= endDay) {
                    const days = [];

                    while (currentDay <= endDay) {
                        const dateObj = new Date(currentDay);
                        const dayOfWeek = dateObj.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
                        const dateNum = dateObj.getUTCDate();
                        const monthNum = dateObj.getUTCMonth() + 1;

                        days.push({
                            label: `${String(dateNum).padStart(2, '0')}/${String(monthNum).padStart(2, '0')}`,
                            fullDate: `${dateObj.getUTCMonth() + 1}/${dateNum}/${dateObj.getUTCFullYear()}`,
                            isWeekend: dayOfWeek === 0 || dayOfWeek === 6
                        });

                        // Increment by exactly 24 hours in UTC
                        currentDay.setUTCDate(currentDay.getUTCDate() + 1);

                        // Week ends on Sunday (dayOfWeek === 0) — Mon-to-Sun weeks
                        if (dayOfWeek === 0) {
                            break;
                        }
                    }

                    if (days.length > 0) {
                        weeks.push({
                            label: `Week ${weekIndex}`,
                            days: days,
                            daysCount: days.length
                        });
                        weekIndex++;
                    }
                }
            } else {
                weeks.push({ label: "Week 1", days: [], daysCount: 1 });
            }
            var gridMinWidth = totalCells * 28;
            oModel.setProperty("/timelineData", { proj: proj, tasks: enrichedTasks, weeks: weeks, totalDayCells: totalCells, gridMinWidth: gridMinWidth + 'px' });

            // Compute Resource timeline data
            const map = new Map();
            enrichedTasks.forEach(task => {
                const rId = task.resourceId || 'unassigned';
                if (!map.has(rId)) {
                    map.set(rId, {
                        resourceId: rId,
                        resourceName: task.resourceName,
                        totalHours: 0,
                        tasks: []
                    });
                }
                const group = map.get(rId);
                group.totalHours += task.hours;

                // Position sequentially
                const topPx = (group.tasks.length * 32) + 8;
                group.tasks.push({ ...task, topPx: topPx });
            });

            const rData = Array.from(map.values()).map(r => {
                r.heightPx = (r.tasks.length * 32) + 16;
                return r;
            });

            oModel.setProperty("/timelineResourceData", rData);

            // Set min-width on grid areas after SAPUI5 renders
            setTimeout(function () {
                var gridAreas = document.querySelectorAll('.timelineGridArea');
                gridAreas.forEach(function (area) {
                    area.style.minWidth = gridMinWidth + 'px';
                });
            }, 200);
        },

        formatCurrency: function (value) {
            if (value === null || value === undefined) return "";
            // Changed formatting to include .00 exactly like your images
            return parseFloat(value).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },

        formatDate: function (dateStr) {
            if (!dateStr) return "";
            const oDate = new Date(dateStr);
            return DateFormat.getDateInstance({ style: "medium" }).format(oDate);
        },
        onEmployeeResourceChange: function () {
            this.getView().getModel().setProperty("/onBehalfOfId", ""); // Reset on behalf when primary changes
            this._computeEmployeeTasks();
        },

        _computeEmployeeTasks: function () {
            const oModel = this.getView().getModel();
            const resourceId = oModel.getProperty("/employeeSelectedResourceId");
            if (!resourceId) {
                oModel.setProperty("/employeeTasks", []);
                oModel.setProperty("/employeeTimeSummary", null);
                this._stopEmployeeTimer();
                return;
            }

            const allTasks = oModel.getProperty("/wbsTasks") || [];
            const projects = oModel.getProperty("/projects") || [];
            const workLogs = oModel.getProperty("/workLogs") || [];
            const resources = oModel.getProperty("/resources") || [];
            const timeData = this._getTimeTrackingData();

            const employeeTasks = allTasks
                .filter(t => t.resourceId === resourceId || t.reallocatedToId === resourceId)
                .map(t => {
                    const proj = projects.find(p => p.id === t.projectId);

                    let reallocationStatusText = "";
                    let isReallocatedToSomeoneElse = false;

                    if (t.resourceId === resourceId && t.reallocatedToId && t.reallocatedToId !== resourceId) {
                        const targetRes = resources.find(r => r.id === t.reallocatedToId);
                        reallocationStatusText = "Reallocated To: " + (targetRes ? targetRes.name : "Unknown");
                        isReallocatedToSomeoneElse = true;
                    } else if (t.reallocatedToId === resourceId && t.resourceId !== resourceId) {
                        const sourceRes = resources.find(r => r.id === t.resourceId);
                        reallocationStatusText = "Reallocated From: " + (sourceRes ? sourceRes.name : "Unknown");
                    }

                    // Sum previously formally logged hours from database
                    const dbHours = workLogs
                        .filter(wl => wl.wbs_ID === t.id && wl.employee_ID === resourceId)
                        .reduce((s, wl) => s + (wl.hours || 0), 0);

                    // Add current unlogged timer time
                    const td = timeData[t.id] || {};
                    const unloggedHours = td.workedHours || 0;
                    const startedAt = td.startedAt || null;

                    let liveHours = dbHours + unloggedHours;
                    if (startedAt && t.status === "Working") {
                        liveHours += (Date.now() - startedAt) / 3600000;
                    }

                    return {
                        ...t,
                        projectName: proj ? proj.name : "Unknown",
                        reallocationStatusText: reallocationStatusText,
                        isReallocatedToSomeoneElse: isReallocatedToSomeoneElse,
                        workedHours: liveHours,
                        liveWorkedHours: Math.round(liveHours * 100) / 100,
                        elapsedDisplay: this._formatElapsed(liveHours),
                        startedAt: startedAt,
                        progressPercent: t.hours > 0 ? Math.min(100, Math.round((liveHours / t.hours) * 100)) : 0,
                        isOvertime: liveHours > t.hours
                    };
                });

            oModel.setProperty("/employeeTasks", employeeTasks);

            // Compute summary
            const totalPlannedHours = employeeTasks.reduce((s, t) => s + (t.hours || 0), 0);
            const totalWorkedHours = employeeTasks.reduce((s, t) => s + (t.liveWorkedHours || 0), 0);
            const completedCount = employeeTasks.filter(t => t.status === "Completed").length;
            const inProgressCount = employeeTasks.filter(t => t.status === "Working").length;
            const totalCount = employeeTasks.length;

            const nonBillableLogs = workLogs.filter(wl => wl.employee_ID === resourceId && wl.isBillable === false);
            const totalNonBillableHours = nonBillableLogs.reduce((s, wl) => s + (wl.hours || 0), 0);
            oModel.setProperty("/employeeNonBillableLogs", nonBillableLogs);

            oModel.setProperty("/employeeTimeSummary", {
                totalPlannedHours: totalPlannedHours,
                totalWorkedDisplay: this._formatElapsed(totalWorkedHours),
                completedCount: completedCount,
                inProgressCount: inProgressCount,
                totalCount: totalCount,
                completionPercent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
                totalNonBillableHours: totalNonBillableHours
            });

            if (employeeTasks.some(t => t.status === "Working")) {
                this._startEmployeeTimer();
            } else {
                this._stopEmployeeTimer();
            }
        },

        _formatElapsed: function (hours) {
            if (!hours || hours <= 0) return "0h 0m";
            const h = Math.floor(hours);
            const m = Math.round((hours - h) * 60);
            return h + "h " + m + "m";
        },

        _getTimeTrackingData: function () {
            try { return JSON.parse(localStorage.getItem("employeeTimeTracking") || "{}"); } catch (e) { return {}; }
        },

        _saveTimeTrackingData: function (data) {
            localStorage.setItem("employeeTimeTracking", JSON.stringify(data));
        },

        _startEmployeeTimer: function () {
            if (this._employeeTimerInterval) return;
            const that = this;
            this._employeeTimerInterval = setInterval(function () {
                that._computeEmployeeTasks();
            }, 60000);
        },

        _stopEmployeeTimer: function () {
            if (this._employeeTimerInterval) {
                clearInterval(this._employeeTimerInterval);
                this._employeeTimerInterval = null;
            }
        },

        _updateEmployeeTaskStatus: async function (task, sNewStatus) {
            const now = Date.now();
            const timeData = this._getTimeTrackingData();
            if (!timeData[task.id]) {
                timeData[task.id] = { workedHours: 0, startedAt: null };
            }

            if (sNewStatus === "Working") {
                timeData[task.id].startedAt = now;
            } else if (sNewStatus === "Paused" || sNewStatus === "Completed") {
                if (timeData[task.id].startedAt) {
                    const elapsed = (now - timeData[task.id].startedAt) / 3600000;
                    timeData[task.id].workedHours = (timeData[task.id].workedHours || 0) + elapsed;
                    timeData[task.id].startedAt = null;
                }
            }
            this._saveTimeTrackingData(timeData);

            // Update models
            const oModel = this.getView().getModel();
            const employeeTasks = oModel.getProperty("/employeeTasks") || [];
            const empIdx = employeeTasks.findIndex(t => t.id === task.id);
            if (empIdx > -1) {
                employeeTasks[empIdx].status = sNewStatus;
                oModel.setProperty("/employeeTasks", [...employeeTasks]);
            }

            const allTasks = oModel.getProperty("/wbsTasks") || [];
            const mainIdx = allTasks.findIndex(t => t.id === task.id);
            if (mainIdx > -1) {
                allTasks[mainIdx].status = sNewStatus;
                oModel.setProperty("/wbsTasks", allTasks);
            }

            const oODataModel = this._getODataModel();
            try {
                const oCtx = oODataModel.bindContext("/WBSTasks(" + task.id + ")").getBoundContext();
                oCtx.setProperty("status", sNewStatus);
                await oODataModel.submitBatch(BATCH_GROUP);
            } catch (e) {
                console.error("Error updating task status", e);
            }
            this._computeEmployeeTasks();
            this._computeTimesheetData();
        },



        onEmployeeTaskEditDialog: function (oEvent) {
            const task = oEvent.getSource().getBindingContext().getObject();
            const oModel = this.getView().getModel();
            
            // Find existing work log for this task
            const workLogs = oModel.getProperty("/workLogs") || [];
            const employeeId = oModel.getProperty("/employeeSelectedResourceId");
            const existingLogs = workLogs.filter(wl => wl.wbs_ID === task.id && wl.employee_ID === employeeId);
            existingLogs.sort((a, b) => new Date(b.date) - new Date(a.date));
            const latestLog = existingLogs[0];

            task.logHours = latestLog ? latestLog.hours : "";
            task.logDescription = latestLog ? latestLog.description : "";
            task.existingLogId = latestLog ? (latestLog.ID || latestLog.id) : null;

            this.getView().getModel().setProperty("/editingEmployeeTask", Object.assign({}, task));
            this._openDialog("EditEmployeeTask");
        },

        onCloseEmployeeTaskEdit: function (oEvent) {
            oEvent.getSource().getParent().close();
        },

        onSaveEmployeeTaskEdit: async function (oEvent) {
            const oModel = this.getView().getModel();
            const editedTask = oModel.getProperty("/editingEmployeeTask");
            
            if (!editedTask.logHours || !editedTask.logDescription) {
                sap.m.MessageToast.show("Please enter hours and description");
                return;
            }

            const oODataModel = this._getODataModel();
            try {
                if (editedTask.existingLogId) {
                    const oBoundCtx = oODataModel.bindContext("/WorkLogs(" + editedTask.existingLogId + ")").getBoundContext();
                    oBoundCtx.setProperty("hours", parseFloat(editedTask.logHours) || 0);
                    oBoundCtx.setProperty("description", editedTask.logDescription);
                } else {
                    this._createEntry(oODataModel, "/WorkLogs", {
                        wbs_ID: editedTask.id,
                        employee_ID: oModel.getProperty("/employeeSelectedResourceId"),
                        date: this._formatDateForOData(new Date()),
                        hours: parseFloat(editedTask.logHours) || 0,
                        isBillable: true,
                        nonBillableType: null,
                        description: editedTask.logDescription
                    });
                }
                await oODataModel.submitBatch(BATCH_GROUP);
                sap.m.MessageToast.show("Work log saved successfully");
                oEvent.getSource().getParent().close();
                await this._loadBackendData();
            } catch (e) {
                console.error("Error saving work log from task edit", e);
                sap.m.MessageToast.show("Failed to save work log");
            }
        },

        onEmployeeTaskStart: function (oEvent) {
            const task = oEvent.getSource().getBindingContext().getObject();
            this._updateEmployeeTaskStatus(task, "Working");
        },

        onEmployeeTaskPause: function (oEvent) {
            const task = oEvent.getSource().getBindingContext().getObject();
            this._updateEmployeeTaskStatus(task, "Paused");
        },

        onEmployeeTaskStop: function (oEvent) {
            const task = oEvent.getSource().getBindingContext().getObject();
            sap.m.MessageBox.confirm("Do you want to log your work?", {
                title: "Log Work",
                actions: [sap.m.MessageBox.Action.YES, sap.m.MessageBox.Action.NO],
                emphasizedAction: sap.m.MessageBox.Action.YES,
                onClose: (sAction) => {
                    if (sAction === sap.m.MessageBox.Action.YES) {
                        this._updateEmployeeTaskStatus(task, "Paused");
                        this._startLogWorkFlow(task);
                    } else {
                        // Just stop timer and keep it Paused instead of completing
                        this._updateEmployeeTaskStatus(task, "Paused");
                    }
                }
            });
        },

        _startLogWorkFlow: function (task) {
            const oModel = this.getView().getModel();

            // Check if there are any unlogged hours in local storage
            const timeData = this._getTimeTrackingData();
            const unloggedHours = (timeData[task.id] && timeData[task.id].workedHours) ? timeData[task.id].workedHours : 0;

            // Format to 2 decimal places if there's unlogged time
            const initialHours = unloggedHours > 0 ? (Math.round(unloggedHours * 100) / 100).toString() : "";

            const today = new Date();
            const todayStr = today.getFullYear() + "-" +
                String(today.getMonth() + 1).padStart(2, '0') + "-" +
                String(today.getDate()).padStart(2, '0');

            const activeEmployeeId = oModel.getProperty("/employeeSelectedResourceId");
            const resources = oModel.getProperty("/resources") || [];
            const activeEmp = resources.find(r => r.id === activeEmployeeId);

            oModel.setProperty("/newWorkLog", {
                taskId: task.id, // Keep track of the task ID 
                taskName: task.name,
                projectName: task.projectName,
                projectId: task.projectId,
                employeeId: activeEmployeeId,
                employeeName: activeEmp ? activeEmp.name : activeEmployeeId,
                date: todayStr,
                hours: initialHours,
                isBillable: true,
                nonBillableType: "",
                description: ""
            });

            this._openDialog("LogWork");
        },

        onSaveWorkLog: async function () {
            const oModel = this.getView().getModel();
            const wl = oModel.getProperty("/newWorkLog");

            if (!wl.date || !wl.hours || !wl.description || (!wl.isBillable && !wl.nonBillableType)) {
                MessageToast.show("Please fill all required fields");
                return;
            }

            const oODataModel = this._getODataModel();
            try {
                this._createEntry(oODataModel, "/WorkLogs", {
                    project_ID: wl.projectId,
                    wbs_ID: wl.taskId,
                    employee_ID: wl.employeeId,
                    date: this._formatDateForOData(wl.date),
                    hours: parseFloat(wl.hours) || 0,
                    isBillable: wl.isBillable,
                    nonBillableType: wl.isBillable ? null : wl.nonBillableType,
                    description: wl.description
                });

                await oODataModel.submitBatch(BATCH_GROUP);

                // Clear out local timer if it was logged
                const timeData = this._getTimeTrackingData();
                if (timeData[wl.taskId]) {
                    timeData[wl.taskId].workedHours = 0; // Reset it since it's now in the database
                    this._saveTimeTrackingData(timeData);
                }

                this.byId("LogWorkDialog").close();
                this._updateEmployeeTaskStatus({ id: wl.taskId }, "Completed");

                sap.m.MessageToast.show("Work entry logged successfully");
                await this._loadBackendData();
            } catch (e) {
                MessageToast.show("Failed to save work log");
                console.error("Error saving work log", e);
            }
        },

        onCloseWorkLogDialog: function () {
            this.byId("LogWorkDialog").close();
        },

        // ============================================================
        // Manual Log Work Logic
        // ============================================================

        onOpenManualLogWork: function () {
            const oModel = this.getView().getModel();
            const resourceId = oModel.getProperty("/employeeSelectedResourceId");

            if (!resourceId) {
                sap.m.MessageToast.show("Please select an employee first");
                return;
            }

            const today = new Date();
            const todayStr = today.getFullYear() + "-" +
                String(today.getMonth() + 1).padStart(2, '0') + "-" +
                String(today.getDate()).padStart(2, '0');

            oModel.setProperty("/newManualWorkLog", {
                employeeId: resourceId,
                projectId: "",
                taskId: "",
                date: todayStr,
                hours: "",
                isBillable: true,
                nonBillableType: "",
                description: "",
                modules:""
            });

            // Make sure the dropdown for tasks is initially empty
            oModel.setProperty("/manualTasks", []);

            // Filter the projects dropdown so it only contains projects this employee has assignments for
            const allTasks = oModel.getProperty("/wbsTasks") || [];
            const allProjects = oModel.getProperty("/projects") || [];

            const userProjectIds = new Set(allTasks.filter(t => {
                // Exclude tasks formally reassigned away
                if (t.resourceId === resourceId && t.reallocatedToId && t.reallocatedToId !== resourceId) return false;

                // Include explicitly assigned or reassigned to this specific proxy user
                return t.resourceId === resourceId || t.reallocatedToId === resourceId;
            }).map(t => t.projectId));

            const manualProjects = allProjects.filter(p => userProjectIds.has(p.id));
            oModel.setProperty("/manualProjects", manualProjects);

            this._openDialog("ManualLogWork");
        },

        onManualProjectChange: function (oEvent) {
            const oModel = this.getView().getModel();
            const sProjectId = oEvent.getSource().getSelectedKey();
            const resourceId = oModel.getProperty("/newManualWorkLog/employeeId");

            const allTasks = oModel.getProperty("/wbsTasks") || [];
            // Filter tasks assigned to this employee on this project
            const filteredTasks = allTasks.filter(t => {
                if (t.projectId !== sProjectId) return false;

                // If it belongs to me originally, but I assigned it away, it's locked out.
                if (t.resourceId === resourceId && t.reallocatedToId && t.reallocatedToId !== resourceId) return false;

                // Include if I am the original owner (and it's not reallocated away), OR if it's reallocated directly to me.
                return t.resourceId === resourceId || t.reallocatedToId === resourceId;
            });

            oModel.setProperty("/manualTasks", filteredTasks);
            oModel.setProperty("/newManualWorkLog/taskId", "");
        },

        onSaveManualWorkLog: async function () {
            const oModel = this.getView().getModel();
            const wl = oModel.getProperty("/newManualWorkLog");

            if (!wl.date || !wl.hours || !wl.description) {
                sap.m.MessageToast.show("Please fill all required fields");
                return;
            }
            if (wl.isBillable && (!wl.projectId || !wl.taskId)) {
                sap.m.MessageToast.show("Please select Project and Task for billable work");
                return;
            }
            if (!wl.isBillable && !wl.nonBillableType) {
                sap.m.MessageToast.show("Please select a Non-Billable Category");
                return;
            }

            const oODataModel = this._getODataModel();
            try {
                this._createEntry(oODataModel, "/WorkLogs", {
                    wbs_ID: wl.isBillable ? wl.taskId : null,
                    employee_ID: wl.employeeId,
                    date: this._formatDateForOData(wl.date),
                    hours: parseFloat(wl.hours) || 0,
                    isBillable: wl.isBillable,
                    nonBillableType: wl.isBillable ? null : wl.nonBillableType,
                    description: wl.description
                });

                await oODataModel.submitBatch(BATCH_GROUP);

                if (wl.isBillable && wl.taskId) {
                    const allTasks = oModel.getProperty("/wbsTasks") || [];
                    const matchedTask = allTasks.find(t => t.id === wl.taskId);
                    if (matchedTask && matchedTask.status !== "Completed") {
                        this._updateEmployeeTaskStatus(matchedTask, "Completed");
                    }

                    // Clear out local timer if it was running/paused
                    const timeData = this._getTimeTrackingData();
                    if (timeData[wl.taskId]) {
                        timeData[wl.taskId].workedHours = 0;
                        timeData[wl.taskId].startedAt = null;
                        this._saveTimeTrackingData(timeData);
                    }
                }

                this.byId("ManualLogWorkDialog").close();
                sap.m.MessageToast.show("Manual work entry logged successfully");
                await this._loadBackendData();
            } catch (e) {
                sap.m.MessageToast.show("Failed to save work log");
                console.error("Error saving manual work log", e);
            }
        },

        onCloseManualWorkLogDialog: function () {
            this.byId("ManualLogWorkDialog").close();
        },

        // ============================================================
        // E-Diary (Timesheet) Logic
        // ============================================================

        _computeTimesheetData: function () {
            const oModel = this.getView().getModel();
            const eDiaryData = oModel.getProperty("/eDiaryView") || [];
            const wbsTasks = oModel.getProperty("/wbsTasks") || [];
            const projects = oModel.getProperty("/projects") || [];
            const resources = oModel.getProperty("/resources") || [];
            const filters = oModel.getProperty("/timesheetFilters") || {};

            let enriched = [...eDiaryData];

            // 1. Inject status into existing logs
            enriched.forEach(log => {
                log.reallocationStatusText = "";
                if (!log.wbsId) {
                    log.status = "None"; // Or whatever fits non-billable
                    log.projectName = "NA";
                    log.taskName = "NA";
                } else {
                    const matchedTask = wbsTasks.find(t => t.id === log.wbsId);
                    log.status = matchedTask ? matchedTask.status : "Unknown";

                    if (matchedTask) {
                        if (matchedTask.resourceId === log.employeeId && matchedTask.reallocatedToId && matchedTask.reallocatedToId !== log.employeeId) {
                            const targetRes = resources.find(r => r.id === matchedTask.reallocatedToId);
                            log.reallocationStatusText = "Reallocated To: " + (targetRes ? targetRes.name : "Unknown");
                        } else if (matchedTask.reallocatedToId === log.employeeId && matchedTask.resourceId !== log.employeeId) {
                            const sourceRes = resources.find(r => r.id === matchedTask.resourceId);
                            log.reallocationStatusText = "Reallocated From: " + (sourceRes ? sourceRes.name : "Unknown");
                        }
                    }
                }
            });

            // 2. Add 'dummy' log rows for assigned tasks that don't have any WorkLogs yet so they show up as 'Not Started' etc.
            const tasksWithLogs = new Set(enriched.map(log => log.wbsId));
            const assignedTasks = wbsTasks.filter(t => t.resourceId);

            assignedTasks.forEach(task => {
                if (!tasksWithLogs.has(task.id)) {
                    const proj = projects.find(p => p.id === task.projectId);
                    const res = resources.find(r => r.id === task.resourceId);
                    
                    let dummyReallocStr = "";
                    if (task.reallocatedToId && task.reallocatedToId !== task.resourceId) {
                        const targetRes = resources.find(r => r.id === task.reallocatedToId);
                        dummyReallocStr = "Reallocated To: " + (targetRes ? targetRes.name : "Unknown");
                    }

                    enriched.push({
                        id: "dummy_" + task.id,
                        date: "", // No date since no work logged
                        hours: 0,
                        isBillable: true,
                        nonBillableType: "",
                        description: "",
                        employeeId: task.resourceId,
                        employeeName: res ? res.name : task.resourceId,
                        wbsId: task.id,
                        taskName: task.name,
                        phaseName: task.phaseName,
                        projectId: task.projectId,
                        projectName: proj ? proj.name : task.projectId,
                        status: task.status || "Not Started",
                        reallocationStatusText: dummyReallocStr
                    });
                }
            });

            // Apply filters (using the flattened fields from the view)
            if (filters.projectId) {
                enriched = enriched.filter(ts => ts.projectId === filters.projectId);
            }
            if (filters.employeeId) {
                enriched = enriched.filter(ts => ts.employeeId === filters.employeeId);
            }
            if (filters.status) {
                enriched = enriched.filter(ts => ts.status === filters.status);
            }

            // Sort by date descending
            enriched.sort((a, b) => {
                // Keep the dummy rows (empty date) at the bottom or top depending, sort normal rows descending
                if (!a.date) return 1;
                if (!b.date) return -1;
                return b.date.localeCompare(a.date);
            });

            oModel.setProperty("/timesheetsForDisplay", enriched);

            // Debug: Reporting Data table columns/data check
            console.groupCollapsed("[Reporting Data] Table Data Check");
            console.log("Filters:", filters);
            console.log("Input eDiaryView rows:", eDiaryData.length);
            console.log("Output timesheetsForDisplay rows:", enriched.length);
            console.table(
                enriched.slice(0, 15).map(function (row) {
                    return {
                        Date: row.date || "",
                        Employee: row.employeeName || "",
                        Project: row.projectName || "NA",
                        "Ticket No": row.ticketNo || "",
                        "Ticket Description": row.description || "",
                        Task: row.taskName || "NA",
                        Reallocation: row.reallocationStatusText || "",
                        Status: row.status || "",
                        Hours: row.hours || 0,
                        Billable: row.isBillable ? "Yes" : "No",
                        "NB Category": row.nonBillableType || "",
                        Notes: row.description || ""
                    };
                })
            );
            console.groupEnd();

            // Compute KPIs (only summing actual numbers)
            const totalHours = enriched.reduce((s, ts) => s + (parseFloat(ts.hours) || 0), 0);
            const nonBillableHours = enriched.filter(ts => ts.id && !ts.id.startsWith("dummy_") && !ts.isBillable).reduce((s, ts) => s + (parseFloat(ts.hours) || 0), 0);
            const billableHours = enriched.filter(ts => ts.id && !ts.id.startsWith("dummy_") && ts.isBillable).reduce((s, ts) => s + (parseFloat(ts.hours) || 0), 0);
            const activeEntriesCount = enriched.filter(ts => ts.id && !ts.id.startsWith("dummy_")).length;

            oModel.setProperty("/timesheetSummary", {
                activeEntries: activeEntriesCount,
                totalDisplayedEntries: enriched.length,
                totalHours: Math.round(totalHours * 100) / 100,
                billableHours: Math.round(billableHours * 100) / 100,
                nonBillableHours: Math.round(nonBillableHours * 100) / 100
            });
        },

        onTimesheetFilterChange: function () {
            this._computeTimesheetData();
        },

        onClearTimesheetFilters: function () {
            this.getView().getModel().setProperty("/timesheetFilters", { projectId: "", employeeId: "", status: "" });
            this._computeTimesheetData();
        },



        onDeleteSingleWorkLog: function (oEvent) {
            const oItem = oEvent.getSource().getBindingContext().getObject();
            if (!oItem.id || oItem.id.startsWith("dummy_")) return;

            sap.m.MessageBox.confirm("Are you sure you want to delete this log entry? This action cannot be undone.", {
                title: "Delete Work Log",
                onClose: async (sAction) => {
                    if (sAction === sap.m.MessageBox.Action.OK) {
                        try {
                            const oODataModel = this._getODataModel();
                            const oListBinding = oODataModel.bindList("/WorkLogs");
                            const aContexts = await oListBinding.requestContexts(0, 5000);
                            const oCtx = aContexts.find(c => {
                                const obj = c.getObject();
                                return obj && (obj.ID === oItem.id || obj.id === oItem.id);
                            });

                            if (oCtx && oCtx.delete) {
                                oCtx.delete(BATCH_GROUP);
                                await oODataModel.submitBatch(BATCH_GROUP);
                                sap.m.MessageToast.show("Work log entry deleted permanently");
                                await this._loadBackendData();
                            }
                        } catch (e) {
                            console.error("Error deleting log", e);
                            sap.m.MessageToast.show("Failed to delete log entry");
                        }
                    }
                }
            });
        },

        onDeleteAllWorkLogs: function () {
            sap.m.MessageBox.warning("WARNING: You are about to permanently delete EVERY single work log in the database. Are you absolutely sure?", {
                title: "Delete ALL Logs",
                actions: [sap.m.MessageBox.Action.DELETE, sap.m.MessageBox.Action.CANCEL],
                emphasizedAction: sap.m.MessageBox.Action.CANCEL,
                onClose: async (sAction) => {
                    if (sAction === sap.m.MessageBox.Action.DELETE) {
                        try {
                            const oODataModel = this._getODataModel();
                            const oListBinding = oODataModel.bindList("/WorkLogs");
                            const aContexts = await oListBinding.requestContexts(0, 5000);

                            let count = 0;
                            aContexts.forEach(c => {
                                if (c && c.delete) {
                                    c.delete(BATCH_GROUP);
                                    count++;
                                }
                            });

                            if (count > 0) {
                                await oODataModel.submitBatch(BATCH_GROUP);
                                sap.m.MessageToast.show(`Successfully deleted all ${count} log entries`);
                                await this._loadBackendData();
                            } else {
                                sap.m.MessageToast.show("No entries to delete");
                            }
                        } catch (e) {
                            console.error("Error deleting all logs", e);
                            sap.m.MessageToast.show("Failed to wipe database entries");
                        }
                    }
                }
            });
        },

        // --- Tickets Allocation Logic ---
        onOpenAddTicketDialog: function () {
            const oModel = this.getView().getModel();
            oModel.setProperty("/newTicket", { date: this._formatDateForOData(new Date()), projectId: "", priority: "Medium", module: "", ticketNo: "", description: "", resourceId: "", onBehalfOfId: "" });

            if (!this._oAddTicketDialog) {
                this.loadFragment({
                    name: "projectmanagement.view.fragments.AddTicket"
                }).then(function (oDialog) {
                    this._oAddTicketDialog = oDialog;
                    this.getView().addDependent(this._oAddTicketDialog);
                    this._oAddTicketDialog.open();
                }.bind(this));
            } else {
                this._oAddTicketDialog.open();
            }
        },

        onCloseAddTicketDialog: function () {
            if (this._oAddTicketDialog) {
                this._oAddTicketDialog.close();
            }
        },

        onSaveTicket: async function () {
            const oModel = this.getView().getModel();
            const oNewTicket = Object.assign({}, oModel.getProperty("/newTicket"));

            if (!oNewTicket.date || !oNewTicket.module || !oNewTicket.ticketNo || !oNewTicket.description || !oNewTicket.resourceId || !oNewTicket.projectId || !oNewTicket.priority) {
                MessageToast.show("Please fill all required fields");
                return;
            }

            try {
                const oODataModel = this._getODataModel();
                const oPayload = {
                    project_ID: oNewTicket.projectId,
                    date: oNewTicket.date,
                    module: oNewTicket.module,
                    ticketNo: oNewTicket.ticketNo,
                    description: oNewTicket.description,
                    priority: oNewTicket.priority,
                    resource_ID: oNewTicket.resourceId
                };

                this._createEntry(oODataModel, "/Tickets", oPayload);
                await oODataModel.submitBatch(BATCH_GROUP);

                MessageToast.show("Ticket saved successfully");
                this.onCloseAddTicketDialog();
                await this._loadBackendData();
            } catch (e) {
                console.error("Error saving ticket", e);
                MessageToast.show("Failed to save ticket");
            }
        },

        onTicketOnBehalfOfChange: function(oEvent) {
            const oComboBox = oEvent.getSource();
            const sSelectedKey = oComboBox.getSelectedKey();
            const oContext = oComboBox.getBindingContext();
            const sPath = oContext.getPath();
            
            const oModel = this.getView().getModel();
            const aResources = oModel.getProperty("/resources") || [];
            const res = aResources.find(r => r.id === sSelectedKey);
            
            if (res) {
                oModel.setProperty(sPath + "/onBehalfOfName", res.name);
            } else {
                oModel.setProperty(sPath + "/onBehalfOfName", "");
            }
        },

        onDeleteTicket: async function (oEvent) {
            const oItem = oEvent.getSource().getParent();
            const sPath = oItem.getBindingContext().getPath();
            const oModel = this.getView().getModel();
            const oTicket = oModel.getProperty(sPath);

            if (!oTicket || !oTicket.id) {
                // Fallback for local-only tickets (e.g. imported but not yet persisted)
                const iIndex = sPath.split("/").pop();
                const aTickets = oModel.getProperty("/tickets");
                aTickets.splice(iIndex, 1);
                oModel.setProperty("/tickets", [...aTickets]);
                oModel.refresh(true);
                return;
            }

            try {
                const oODataModel = this._getODataModel();
                const oBinding = oODataModel.bindContext("/Tickets(" + oTicket.id + ")");
                await oBinding.requestObject();
                const oContext = oBinding.getBoundContext();
                oContext.delete(BATCH_GROUP);
                await oODataModel.submitBatch(BATCH_GROUP);
                MessageToast.show("Ticket deleted");
                await this._loadBackendData();
            } catch (e) {
                console.error("Error deleting ticket", e);
                MessageToast.show("Failed to delete ticket");
            }
        },

        onImportTicketsCSV: function() {
            this.byId("ticketsExcelFileUploader").clear();
            // Programmatically trigger the hidden file uploader
            this.byId("ticketsExcelFileUploader").$().find("input[type=file]").trigger("click");
        },

        onImportTicketsExcelFile: function(oEvent) {
            const oFile = oEvent.getParameter("files") && oEvent.getParameter("files")[0];
            if (!oFile) {
                MessageToast.show("No file selected.");
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const data = new Uint8Array(e.target.result);
                try {
                    // Check if XLSX is available
                    if (typeof XLSX === "undefined") {
                        sap.m.MessageBox.error("SheetJS (XLSX) library is not loaded. Please make sure it is included in your index.html.");
                        return;
                    }
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

                    if (json && json.length > 0) {
                        this._processImportedTickets(json);
                    } else {
                        MessageToast.show("The file is empty or could not be parsed.");
                    }
                } catch (error) {
                    sap.m.MessageBox.error("Error reading file. Ensure it's a valid Excel or CSV file.");
                    console.error("Parse error:", error);
                }
            };
            reader.readAsArrayBuffer(oFile);
        },

        _processImportedTickets: function(dataArray) {
            const oModel = this.getView().getModel();
            const aTickets = oModel.getProperty("/tickets") || [];
            const aResources = oModel.getProperty("/resources") || [];
            
            let iCount = 0;

            dataArray.forEach(row => {
                // Try to find matching columns based on common names
                const dateRaw = row["Date"] || row["date"] || "";
                const module = row["Module"] || row["module"] || "";
                const ticketNo = row["Ticket No"] || row["Ticket Ref"] || row["ticketNo"] || "";
                const desc = row["Description"] || row["Ticket Description"] || row["description"] || "";
                const resourceStr = row["Resource"] || row["Employee"] || row["resource"] || "";
                const onBehalfStr = row["On Behalf Of"] || row["onBehalfOf"] || "";

                if (ticketNo || desc) {
                    const oTicket = {
                        date: this._formatDateForOData(dateRaw) || this._formatDateForOData(new Date()),
                        module: module,
                        ticketNo: ticketNo,
                        description: desc
                    };

                    // Try to match resources
                    const resMatch = aResources.find(r => r.name && r.name.toLowerCase() === resourceStr.toLowerCase());
                    if (resMatch) {
                        oTicket.resourceId = resMatch.id;
                        oTicket.resourceName = resMatch.name;
                    }

                    const behalfMatch = aResources.find(r => r.name && r.name.toLowerCase() === onBehalfStr.toLowerCase());
                    if (behalfMatch) {
                        oTicket.onBehalfOfId = behalfMatch.id;
                        oTicket.onBehalfOfName = behalfMatch.name;
                    }

                    aTickets.unshift(oTicket);
                    iCount++;
                }
            });

            oModel.setProperty("/tickets", aTickets);
            oModel.refresh(true);
            MessageToast.show("Successfully imported " + iCount + " tickets.");
        },

        formatDecimal: function (value) {
            if (value === null || value === undefined) return "0.00";
            return parseFloat(value).toFixed(2);
        }
    });
});
