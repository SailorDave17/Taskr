package com.taskr.core.Resources;


import javax.persistence.*;

import java.util.HashSet;
import java.util.Set;


@Entity
public class User {
    private String name;
    // Reminder to self that the error "OneToMany attribute type should not be(...) was caused
    // by the target not being an @Entity and the Set not being generic enough (was HashSet)
    @OneToMany(mappedBy = "ownedBy")
    private Set<Task> taskList;

    @Id
    @GeneratedValue
    private Long id;

    protected User() {
    }

    public User(String name) {
        this.name = name;
        Set<Task> taskList = new HashSet<>();
    }

    public void addTask(Task task) {
        taskList.add(task);
    }

    public void deleteTask(Task task) {
        this.taskList.remove(task);
    }

    public Set<Task> getTaskList() {
        return taskList;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Long getId() {
        return id;
    }


}
