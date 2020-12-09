package com.taskr.core.controller;

import com.taskr.core.model.Task;
import com.taskr.core.model.TaskTemplate;
import com.taskr.core.model.User;
import com.taskr.core.storage.TaskStorage;
import com.taskr.core.storage.TaskTemplateStorage;
import com.taskr.core.storage.UserStorage;
import org.springframework.web.bind.annotation.*;

import java.util.Date;

@RestController
@CrossOrigin
public class UserController {

    private UserStorage userStorage;
    private TaskTemplateStorage taskTemplateStorage;
    private TaskStorage taskStorage;

    public UserController(UserStorage userStorage, TaskTemplateStorage taskTemplateStorage, TaskStorage taskStorage) {
        this.userStorage = userStorage;
        this.taskTemplateStorage = taskTemplateStorage;
        this.taskStorage = taskStorage;
    }

    @GetMapping("/api/user/{id}")
    public User retrieveUserById(@PathVariable Long id) {
        return userStorage.findById(id);
    }

    @PatchMapping("/api/user/{id}/remove_task")
    public User removeTaskFromUser(@PathVariable Long id, @RequestBody Task taskInput) {
        User user = userStorage.findById(id);
        Task task = taskStorage.findById(taskInput.getId());
        user.deleteTask(task);
        taskStorage.deleteById(task.getId());
        userStorage.save(user);
        return user;
    }

    @PostMapping("/api/user/new")
    public Iterable<User> addNewUser(@RequestBody User user) {
        userStorage.save(user);
        return userStorage.findAll();
    }

    @PatchMapping("/api/user/{id}/update")
    public Iterable<User> updateUserInfo(@PathVariable Long id, @RequestBody User user) {
        User existingUser = userStorage.findById(id);
        if(user.getName() != null){
            existingUser.setName(user.getName());
        }
        if(user.getTotalAvailableTime() != null){
            existingUser.setTotalAvailableTime(user.getTotalAvailableTime());
        }
        if(user.getUserColor() != null){
            existingUser.setUserColor(user.getUserColor());
        }
        if(user.getUserIcon() != null){
            existingUser.setUserIcon(user.getUserIcon());
        }
        userStorage.updateUser(existingUser);
        userStorage.save(existingUser);
        return userStorage.findAll();
    }

    @GetMapping("/api/user/{id}/delete")
    public Iterable<User> deleteUser(@PathVariable Long id) {
        if (userStorage.findById(id) != null) {
            userStorage.deleteById(id);
        }
        return userStorage.findAll();
    }

    @GetMapping("/api/users")
    public Iterable<User> retrieveAllUsers() {
        return userStorage.findAll();
    }
}
