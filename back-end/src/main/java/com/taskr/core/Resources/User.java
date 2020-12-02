package com.taskr.core.Resources;


import com.fasterxml.jackson.annotation.JsonBackReference;
import com.fasterxml.jackson.annotation.JsonManagedReference;

import javax.persistence.*;

import java.util.HashSet;
import java.util.Objects;
import java.util.Set;


@Entity
public class User {
    private String name;
    // Reminder to self that the error "OneToMany attribute type should not be(...) was caused
    // by the target not being an @Entity and the Set not being generic enough (was HashSet)
    @JsonManagedReference
    @OneToMany(mappedBy = "ownedBy")
    private Set<Task> taskList;

    @Id
    @GeneratedValue
    private Long id;
    private Integer availableTime;
    private String userColor;

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

    public Integer getAvailableTime() {
        return availableTime;
    }

    public void setAvailableTime(Integer availableTime) {
        this.availableTime = availableTime;
    }

    public String getUserColor() {
        return userColor;
    }

    public void setUserColor(String userColor) {
        this.userColor = userColor;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        User user = (User) o;
        return name.equals(user.name) &&
                id.equals(user.id);
    }

    @Override
    public int hashCode() {
        return Objects.hash(name, id);
    }

}
