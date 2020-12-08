package com.taskr.core.controller;


import com.taskr.core.ResourceManager;
import com.taskr.core.resources.Task;
import com.taskr.core.resources.TaskTemplate;
import com.taskr.core.resources.User;
import com.taskr.core.storages.TaskStorage;
import com.taskr.core.storages.TaskTemplateStorage;
import com.taskr.core.storages.UserStorage;
import org.springframework.web.bind.annotation.*;

import java.util.Set;

@RestController
@CrossOrigin
public class HouseholdController {

    private UserStorage userStorage;
    private TaskTemplateStorage taskTemplateStorage;
    private TaskStorage taskStorage;
    private ResourceManager resourceManager;

    public HouseholdController(TaskStorage taskStorage, UserStorage userStorage, TaskTemplateStorage taskTemplateStorage, ResourceManager resourceManager) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
        this.resourceManager = resourceManager;
    }

    @GetMapping("/api/household")
    public Iterable<User> retrieveAllHousehold(){
        return userStorage.findAll();
    }

    @GetMapping("/api/household/tasks")
    public Iterable<TaskTemplate> retrieveAllHouseholdTasks(){
        return taskTemplateStorage.findAll();
    }

    @PostMapping("/api/household/new_household_task")
    public TaskTemplate createNewHouseholdTask(TaskTemplate taskTemplate){
        taskTemplateStorage.save(taskTemplate);
        return taskTemplate;
    }

    @GetMapping("/api/household/delete_household_task/{id}")
    public Iterable<TaskTemplate> deleteTaskFromHousehold(@PathVariable Long id){
        taskStorage.deleteByTemplateId(id);
        taskTemplateStorage.deleteById(id);
        return taskTemplateStorage.findAll();
    }

    @PatchMapping("/api/household/update_household_task/{id}")
    public TaskTemplate updateExistingHouseholdTask(@PathVariable Long id, @RequestBody TaskTemplate taskTemplate){
        TaskTemplate existingTaskTemplate = taskTemplateStorage.findById(id);
        if(taskTemplate.getActualWorkTime() != null){
            existingTaskTemplate.setActualWorkTime(taskTemplate.getActualWorkTime());
        }
        if(taskTemplate.getMinutesExpectedToComplete() != null){
            existingTaskTemplate.setMinutesExpectedToComplete(taskTemplate.getMinutesExpectedToComplete());
        }
        if(taskTemplate.getName() != null){
            existingTaskTemplate.setName(taskTemplate.getName());
        }
        if(taskTemplate.getDescription() != null){
            existingTaskTemplate.setDescription(taskTemplate.getDescription());
        }
        if(taskTemplate.getUsersWhoCannotDoThisTask() != null){
            existingTaskTemplate.setUsersWhoCannotDoThisTask(taskTemplate.getUsersWhoCannotDoThisTask());
        }
        taskTemplateStorage.save(existingTaskTemplate);
        resourceManager.updateAllTasksBasedOnTemplate(existingTaskTemplate.getId());
        return existingTaskTemplate;
    }

    @PostMapping("/api/household/assign_tasks")
    public Iterable<Task> assignTasks(@RequestBody Iterable<TaskTemplate> taskTemplateList){
        resourceManager.allocateTasks((Set<TaskTemplate>) taskTemplateList);
        return taskStorage.findAll();
    }

    @PostMapping("/api/household/assign_all_tasks")
    public Iterable<Task> assignAllTasks(){
        resourceManager.allocateAllTasks();
        return taskStorage.findAll();
    }
}
