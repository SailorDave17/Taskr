const displayCustomizeTasksView = function(tasks) {
    const mainTaskCustomizeElement = document.createElement("main");
    mainTaskCustomizeElement.classList.add("main-task-customize-element");
    const listOfDefaultTasks = document.createElement("div");
    listOfDefaultTasks.classList.add("list-of-default-tasks");
    const addTaskButton = document.createElement("button");
    addTaskButton.classList.add("add-task");
    addTaskButton.innerText = "Add Task";
    const taskDurationHeader = document.createElement("button");
    taskDurationHeader.classList.add("task-duration-header");
    taskDurationHeader.innerText = "Task Duration";
    const taskDueDate = document.createElement("button");
    taskDueDate.classList.add("due-date");
    taskDueDate.innerText = "Task Due Date";
    const taskFrequency = document.createElement("button");
    taskFrequency.classList.add("task-frequency");
    taskFrequency.innerText = "Task Frequency";
    const multipleUserFrequency = document.createElement("button");
    multipleUserFrequency.classList.add("multiple-user-frequency");
    multipleUserFrequency.innerText = "Multiple User Option";
    const dropButtonUser1 = document.createElement("button");
    dropButtonUser1.classList.add("dropbtn-user");
    dropButtonUser1.setAttribute("id", "mom");
    dropButtonUser1.innerText = "Mom"
        //dropButtonUser1.setAttribute("id", user.name);
        //dropButtonUser1.innerText = user.name;
    const dropButtonUser2 = document.createElement("button");
    dropButtonUser2.classList.add("dropbtn-user");
    dropButtonUser2.setAttribute("id", "dad");
    dropButtonUser2.innerText = "Dad"
        //dropButtonUser2.setAttribute("id", user.name);
        //dropButtonUser2.innerText = user.name;
    const dropButtonUser3 = document.createElement("button");
    dropButtonUser3.classList.add("dropbtn-user");
    dropButtonUser3.setAttribute("id", "bro");
    dropButtonUser3.innerText = "Bro"
        //dropButtonUser1.setAttribute("id", user.name);
        //dropButtonUser1.innerText = user.name;
    const dropButtonUser4 = document.createElement("button");
    dropButtonUser4.classList.add("dropbtn-user");
    dropButtonUser4.setAttribute("id", "sis");
    dropButtonUser4.innerText = "Sis"
        //dropButtonUser2.setAttribute("id", user.name);
        //dropButtonUser2.innerText = user.name;

}